import { Prisma, RedemptionStatus } from "@generated/prisma";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { VendorRegistry } from "../../providers/vendor-api/vendor-registry.service";
import { FulfilmentService } from "../../fulfilment/fulfilment.service";

@Processor("redeem-processing", { concurrency: 5 })
export class RedeemProcessor extends WorkerHost {
  private readonly logger = new Logger(RedeemProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: VendorRegistry,
    private readonly fulfilment: FulfilmentService,
  ) {
    super();
  }

  async process(job: Job<{ redemptionId: string }>): Promise<void> {
    const { redemptionId } = job.data;

    const redemption = await this.prisma.pointRedemption.findUnique({
      where: { id: redemptionId },
      include: {
        productVariant: { include: { product: true } },
        productPrice: { include: { vendor: true } },
        user: { select: { id: true } },
      },
    });

    if (!redemption) {
      this.logger.warn(`Redemption ${redemptionId} not found`);
      return;
    }

    if (
      redemption.status === RedemptionStatus.COMPLETED ||
      redemption.status === RedemptionStatus.REFUNDED
    ) {
      return;
    }

    // Whether `createOrder` was called. Once retries are gone this decides
    // between "refund — the vendor never heard of it" and "ops — an order
    // may exist on the vendor side".
    let orderAttempted = false;

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

      // Throws UnsupportedVendorError before any order is placed — that
      // path refunds, since the vendor never heard of it.
      const vendor = this.vendors.get(redemption.productPrice.vendor.name);

      orderAttempted = true;
      const orderResponse = await vendor.createOrder(
        brandKey,
        variationKey,
        price,
        formData,
        redemptionId,
      );

      const vendorRefId = orderResponse.data?.data?.trx_code;
      if (!orderResponse.success || !vendorRefId) {
        // Definitive rejection → the fulfilment leg has marked it FAILED
        // and refunded. Ambiguous → throw so BullMQ retries; the vendor
        // is expected to dedupe on `ref_id` (= redemptionId).
        const cls = await this.fulfilment.onVendorRejected(
          "redemption",
          redemptionId,
          orderResponse,
        );
        if (cls === "definitive") return;
        throw new Error(`Vendor error: ${orderResponse.message}`);
      }

      // Money leg done: points spent, vendor has the order. The "ready"
      // push comes from the fulfilment leg once the vendor confirms.
      await this.prisma.pointRedemption.update({
        where: { id: redemptionId },
        data: {
          status: RedemptionStatus.COMPLETED,
          vendorRefId,
          vendorResponse:
            orderResponse.data as unknown as Prisma.InputJsonValue,
        },
      });
      await this.fulfilment.onVendorAccepted("redemption", redemptionId);

      this.logger.log(`Redemption ${redemptionId} accepted by vendor`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Redemption ${redemptionId} failed: ${msg}`);

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

      // Out of retries: refund only if the vendor was never reached.
      // Refunding a timed-out order that the vendor did place would hand
      // the buyer both the product and the points.
      const budget = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= budget) {
        await this.fulfilment
          .onOrderRetriesExhausted("redemption", redemptionId, {
            orderAttempted,
            error: msg,
          })
          .catch((err) =>
            this.logger.error(
              `[redeem] fulfilment settle failed for ${redemptionId}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }

      throw error; // allow BullMQ retries
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job, err: Error) {
    const maxAttempts = job.opts?.attempts ?? 1;
    this.logger.error(
      `Redemption job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${err.message}`,
    );
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.log(`Redemption job ${job.id} completed`);
  }
}
