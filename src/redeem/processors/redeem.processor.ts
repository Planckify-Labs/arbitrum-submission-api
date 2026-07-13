import {
  PointTransactionStatus,
  PointTransactionType,
  Prisma,
  RedemptionStatus,
} from "@generated/prisma";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { VCGamersService } from "../../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import { PushService } from "../../push/push.service";
import { PointsCacheService } from "../../valkey/services/points-cache.service";

// Matches the "en-US" grouping used for points/currency everywhere else
// in the app (see mobile `utils/currencyUtils.ts` formatNumber) — accepts
// bigint directly, no need to round-trip through Number.
const POINTS_NUMBER_FORMAT = new Intl.NumberFormat("en-US");

@Processor("redeem-processing", { concurrency: 5 })
export class RedeemProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vcGamersService: VCGamersService,
    private readonly pointsCache: PointsCacheService,
    private readonly pushService: PushService,
  ) {
    super();
  }

  async process(job: Job<{ redemptionId: string }>): Promise<void> {
    const { redemptionId } = job.data;
    const logger = new Logger(RedeemProcessor.name);

    const redemption = await this.prisma.pointRedemption.findUnique({
      where: { id: redemptionId },
      include: {
        productVariant: { include: { product: true } },
        productPrice: { include: { vendor: true } },
        user: { select: { id: true } },
      },
    });

    if (!redemption) {
      logger.warn(`Redemption ${redemptionId} not found`);
      return;
    }

    if (
      redemption.status === RedemptionStatus.COMPLETED ||
      redemption.status === RedemptionStatus.REFUNDED
    ) {
      return;
    }

    try {
      await this.prisma.pointRedemption.update({
        where: { id: redemptionId },
        data: { status: RedemptionStatus.PROCESSING },
      });

      const brandKey = redemption.productVariant.product.code;
      const variationKey = redemption.productVariant.variantCode;
      const price = Number(redemption.productPrice.priceFromVendor);

      const customerInfo = redemption.customerInfo;
      if (!customerInfo) throw new Error("Customer info is required");

      let formData: Array<{ key: string; value: string }>;
      if (Array.isArray(customerInfo)) {
        formData = customerInfo as Array<{ key: string; value: string }>;
      } else {
        formData = Object.entries(customerInfo as Record<string, string>).map(
          ([key, value]) => ({ key, value: String(value) }),
        );
      }

      // Only call VCGamers if vendor is vcGamer
      if (redemption.productPrice.vendor.name !== "vcGamer") {
        throw new Error(
          `Unsupported vendor: ${redemption.productPrice.vendor.name}`,
        );
      }

      const orderResponse = await this.vcGamersService.createOrder(
        brandKey,
        variationKey,
        price,
        formData,
        redemptionId,
      );

      if (!orderResponse.success) {
        throw new Error(`Vendor error: ${orderResponse.message}`);
      }

      await this.prisma.pointRedemption.update({
        where: { id: redemptionId },
        data: {
          status: RedemptionStatus.COMPLETED,
          vendorRefId: orderResponse.data?.data.trx_code,
          vendorResponse:
            orderResponse.data as unknown as Prisma.InputJsonValue,
        },
      });

      logger.log(`Redemption ${redemptionId} completed`);

      // Best-effort. Product name only — never the fulfillment vendor
      // (e.g. "vcGamer") or any vendor reference/order data.
      const productName =
        `${redemption.productVariant.product.name} ${redemption.productVariant.name}`.trim();
      await this.pushService
        .sendToUser({
          userId: redemption.user.id,
          title: "Redemption Ready",
          body: `Your ${productName} is ready to use!`,
          data: {
            type: "redemption",
            redemptionId,
            status: "COMPLETED",
          },
          channelId: "points",
          source: "redemption",
        })
        .catch((err) => {
          logger.warn(
            `[redeem] push failed for ${redemptionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Redemption ${redemptionId} failed: ${msg}`);

      await this.prisma.pointRedemption.update({
        where: { id: redemptionId },
        data: {
          status: RedemptionStatus.FAILED,
          metadata: {
            error: msg,
            failedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      throw error; // allow BullMQ retries
    }
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job, err: Error) {
    const logger = new Logger(RedeemProcessor.name);
    const maxAttempts = job.opts?.attempts ?? 1;
    logger.error(
      `Redemption job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${err.message}`,
    );

    // Only refund on the final attempt
    if (job.attemptsMade >= maxAttempts) {
      await this.refundRedemption(job.data.redemptionId);
    }
  }

  private async refundRedemption(redemptionId: string): Promise<void> {
    const logger = new Logger(RedeemProcessor.name);

    const redemption = await this.prisma.pointRedemption.findUnique({
      where: { id: redemptionId },
      include: { productVariant: { include: { product: true } } },
    });

    if (!redemption || redemption.status === RedemptionStatus.REFUNDED) return;

    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.pointBalance.findUnique({
        where: { userId: redemption.userId },
      });

      const currentBalance = balance?.balance ?? BigInt(0);
      const newBalance = currentBalance + redemption.pointsSpent;

      if (balance) {
        await tx.pointBalance.update({
          where: { userId: redemption.userId },
          data: { balance: newBalance },
        });
      } else {
        await tx.pointBalance.create({
          data: { userId: redemption.userId, balance: newBalance },
        });
      }

      await tx.pointTransaction.create({
        data: {
          userId: redemption.userId,
          type: PointTransactionType.REFUND,
          status: PointTransactionStatus.COMPLETED,
          amount: redemption.pointsSpent,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          referenceType: "POINT_REDEMPTION",
          referenceId: redemptionId,
        },
      });

      await tx.pointRedemption.update({
        where: { id: redemptionId },
        data: { status: RedemptionStatus.REFUNDED },
      });
    });

    await this.pointsCache.invalidateBalance(redemption.userId);
    logger.log(
      `Refunded ${redemption.pointsSpent} points for redemption ${redemptionId}`,
    );

    // Best-effort. Product name only — never the fulfillment vendor.
    const productName =
      `${redemption.productVariant.product.name} ${redemption.productVariant.name}`.trim();
    const pointsFormatted = POINTS_NUMBER_FORMAT.format(redemption.pointsSpent);
    await this.pushService
      .sendToUser({
        userId: redemption.userId,
        title: "Redemption Failed",
        body: `Your ${productName} redemption didn't go through, but no worries, ${pointsFormatted} points have been refunded to your balance.`,
        data: {
          type: "redemption",
          redemptionId,
          status: "REFUNDED",
        },
        channelId: "points",
        source: "redemption",
      })
      .catch((err) => {
        logger.warn(
          `[redeem] refund push failed for ${redemptionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    new Logger(RedeemProcessor.name).log(`Redemption job ${job.id} completed`);
  }
}
