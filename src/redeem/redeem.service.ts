import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { PointsCacheService } from "../valkey/services/points-cache.service";
import { ProductInputValidatorService } from "../products/services/product-input-validator.service";
import { VCGamersService } from "../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import { FulfilmentService } from "../fulfilment/fulfilment.service";
import {
  fulfilmentView,
  isWorthChecking,
  legacyVoucherCode,
} from "../fulfilment/fulfilment-view";
import {
  Prisma,
  PointTransactionType,
  PointTransactionStatus,
  RedemptionStatus,
} from "@generated/prisma";
import { ExecuteRedeemDto } from "./dto/execute-redeem.dto";
import { RedeemHistoryQueryDto } from "./dto/redeem-history-query.dto";

const DecimalLib = Prisma.Decimal;

@Injectable()
export class RedeemService {
  private readonly logger = new Logger(RedeemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productInputValidator: ProductInputValidatorService,
    private readonly pointsCache: PointsCacheService,
    private readonly vcGamersService: VCGamersService,
    private readonly fulfilment: FulfilmentService,
    @InjectQueue("redeem-processing") private readonly redeemQueue: Queue,
  ) {}

  async executeRedeem(userId: string, dto: ExecuteRedeemDto) {
    // 1. Fetch user
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    // 2. Fetch ProductVariant with product
    const productVariant = await this.prisma.productVariant.findUnique({
      where: { id: dto.productVariantId },
      include: { product: true },
    });

    if (!productVariant) {
      throw new NotFoundException(
        `Product variant with ID ${dto.productVariantId} not found`,
      );
    }

    if (!productVariant.isActive) {
      throw new BadRequestException("Product variant is not active");
    }

    if (!productVariant.product.isActive) {
      throw new BadRequestException("Product is not active");
    }

    // 3. Fetch ProductPrice
    const productPrice = await this.prisma.productPrice.findFirst({
      where: {
        id: dto.productPriceId,
        productVariantId: dto.productVariantId,
        isActive: true,
      },
      include: { vendor: true },
    });

    if (!productPrice) {
      throw new NotFoundException(
        `Product price with ID ${dto.productPriceId} not found or not active`,
      );
    }

    // 4. Validate customerInfo
    const validatedCustomerInfo =
      await this.productInputValidator.validateCustomerInfo(
        productVariant.product.id,
        dto.customerInfo as
          | Record<string, string | number | boolean | string[]>
          | Array<{ key: string; value: string }>
          | undefined,
      );

    // 5. Calculate pointsRequired — 1 point = 1 currency unit (sellPrice is the direct cost in points)
    const pointsRequired = BigInt(
      new DecimalLib(productPrice.sellPrice.toString()).ceil().toFixed(0),
    );

    // 7. Check idempotency — no existing non-failed redemption for same product+user+price
    // (no bookingOrderId to key on, so we skip this for now)

    // 8. Execute in transaction
    const { redemption } = await this.prisma.$transaction(async (tx) => {
      // Fetch and check balance
      const balance = await tx.pointBalance.findUnique({ where: { userId } });
      const currentBalance = balance?.balance ?? BigInt(0);

      if (currentBalance < pointsRequired) {
        throw new BadRequestException(
          `Insufficient point balance: have ${currentBalance}, need ${pointsRequired}`,
        );
      }

      const newBalance = currentBalance - pointsRequired;

      // Decrement balance
      if (balance) {
        await tx.pointBalance.update({
          where: { userId },
          data: { balance: newBalance },
        });
      } else {
        await tx.pointBalance.create({
          data: { userId, balance: newBalance },
        });
      }

      // Create PointTransaction (SPEND)
      const pointTx = await tx.pointTransaction.create({
        data: {
          userId,
          type: PointTransactionType.SPEND,
          status: PointTransactionStatus.COMPLETED,
          amount: -pointsRequired,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          referenceType: "POINT_REDEMPTION",
        },
      });

      // Create PointRedemption
      const redemption = await tx.pointRedemption.create({
        data: {
          userId,
          pointTransactionId: pointTx.id,
          pointTransactionCreatedAt: pointTx.createdAt,
          productVariantId: dto.productVariantId,
          productPriceId: dto.productPriceId,
          customerInfo:
            validatedCustomerInfo as unknown as Prisma.InputJsonValue,
          status: "PENDING",
          pointsSpent: pointsRequired,
        },
      });

      // Link PointTransaction back to redemption
      await tx.pointTransaction.update({
        where: {
          id_createdAt: { id: pointTx.id, createdAt: pointTx.createdAt },
        },
        data: { referenceId: redemption.id },
      });

      return { redemption };
    });

    // 9. Invalidate point balance cache
    await this.pointsCache.invalidateBalance(userId);

    // 10. Enqueue redemption job
    await this.redeemQueue.add(
      "process-redemption",
      { redemptionId: redemption.id },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 3000 },
      },
    );

    this.logger.log(`Redemption ${redemption.id} submitted for user ${userId}`);

    return {
      id: redemption.id,
      status: "PENDING",
      pointsSpent: pointsRequired.toString(),
      message: "Redemption submitted. Processing your order.",
    };
  }

  async getRedeemById(userId: string, redemptionId: string) {
    const include = {
      productVariant: { include: { product: true } },
      productPrice: true,
      refund: { select: { status: true, points: true } },
    } as const;

    let redemption = await this.prisma.pointRedemption.findFirst({
      where: { id: redemptionId, userId },
      include,
    });

    if (!redemption) {
      throw new NotFoundException("Redemption not found");
    }

    // The user is looking and the poller hasn't asked recently: ask now,
    // through the same state machine the pushes come from.
    if (isWorthChecking(redemption)) {
      try {
        await this.fulfilment.check("redemption", redemptionId, {
          reschedule: false,
        });
        redemption =
          (await this.prisma.pointRedemption.findFirst({
            where: { id: redemptionId, userId },
            include,
          })) ?? redemption;
      } catch (error) {
        this.logger.warn(
          `Live fulfilment check failed for redemption ${redemptionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const fulfilment = fulfilmentView(redemption);
    const voucherCode = legacyVoucherCode(
      fulfilment.delivery,
      redemption.deliveryRaw,
    );

    return {
      id: redemption.id,
      status: redemption.status,
      pointsSpent: redemption.pointsSpent.toString(),
      vendorRefId: redemption.vendorRefId,
      voucherCode,
      fulfilment,
      customerInfo: redemption.customerInfo,
      product: {
        id: redemption.productVariant.product.id,
        name: redemption.productVariant.product.name,
        imageUrl: redemption.productVariant.product.imageUrl,
        isVoucher: redemption.productVariant.product.isVoucher,
        deliveryType: fulfilment.deliveryType,
        variant: {
          id: redemption.productVariant.id,
          name: redemption.productVariant.name,
        },
        price: {
          amount: Number(redemption.productPrice.sellPrice),
          currency: redemption.productPrice.currency,
        },
      },
      createdAt: redemption.createdAt.toISOString(),
      updatedAt: redemption.updatedAt.toISOString(),
    };
  }

  async getRedeemStatus(userId: string, redemptionId: string) {
    const redemption = await this.prisma.pointRedemption.findFirst({
      where: { id: redemptionId, userId },
    });

    if (!redemption) {
      throw new NotFoundException("Redemption not found");
    }

    return {
      id: redemption.id,
      status: redemption.status,
      fulfilmentStatus: redemption.fulfilmentStatus,
      expectedBy: redemption.expectedBy?.toISOString() ?? null,
      pointsSpent: redemption.pointsSpent.toString(),
      vendorRefId: redemption.vendorRefId,
      createdAt: redemption.createdAt.toISOString(),
    };
  }

  // ── Admin: list all redemptions ─────────────────────────────────────────

  async findAllAdmin(query: RedeemHistoryQueryDto & { userId?: string }) {
    const limit = query.limit ?? 20;
    const skipOffset =
      typeof query.skip === "number" && query.skip > 0 ? query.skip : undefined;

    const baseWhere: Prisma.PointRedemptionWhereInput = {};
    if (query.userId) baseWhere.userId = query.userId;
    if (query.status) baseWhere.status = query.status;

    const listWhere: Prisma.PointRedemptionWhereInput = { ...baseWhere };
    if (!skipOffset && query.cursor) {
      listWhere.id = { lt: query.cursor };
    }

    const [records, total] = await Promise.all([
      this.prisma.pointRedemption.findMany({
        where: listWhere,
        take: limit + 1,
        ...(skipOffset ? { skip: skipOffset } : {}),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          user: { select: { id: true, username: true, email: true } },
          productVariant: { include: { product: true } },
          productPrice: true,
        },
      }),
      this.prisma.pointRedemption.count({ where: baseWhere }),
    ]);

    const hasMore = records.length > limit;
    const data = hasMore ? records.slice(0, limit) : records;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      total,
      data: data.map((r) => ({
        id: r.id,
        status: r.status,
        pointsSpent: r.pointsSpent.toString(),
        vendorRefId: r.vendorRefId,
        customerInfo: r.customerInfo,
        user: r.user,
        product: {
          id: r.productVariant.product.id,
          name: r.productVariant.product.name,
          imageUrl: r.productVariant.product.imageUrl,
          isVoucher: r.productVariant.product.isVoucher,
          variant: {
            id: r.productVariant.id,
            name: r.productVariant.name,
          },
          price: {
            amount: Number(r.productPrice.sellPrice),
            currency: r.productPrice.currency,
          },
        },
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    };
  }

  // ── Admin: get any redemption by ID ───────────────────────────────────────

  async findOneAdmin(id: string) {
    const redemption = await this.prisma.pointRedemption.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true } },
        productVariant: { include: { product: true } },
        productPrice: true,
      },
    });
    if (!redemption) throw new NotFoundException(`Redemption ${id} not found`);
    return {
      id: redemption.id,
      status: redemption.status,
      pointsSpent: redemption.pointsSpent.toString(),
      vendorRefId: redemption.vendorRefId,
      customerInfo: redemption.customerInfo,
      user: redemption.user,
      product: {
        id: redemption.productVariant.product.id,
        name: redemption.productVariant.product.name,
        imageUrl: redemption.productVariant.product.imageUrl,
        isVoucher: redemption.productVariant.product.isVoucher,
        variant: {
          id: redemption.productVariant.id,
          name: redemption.productVariant.name,
        },
        price: {
          amount: Number(redemption.productPrice.sellPrice),
          currency: redemption.productPrice.currency,
        },
      },
      createdAt: redemption.createdAt.toISOString(),
      updatedAt: redemption.updatedAt.toISOString(),
    };
  }

  async getRedeemHistory(userId: string, query: RedeemHistoryQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.PointRedemptionWhereInput = { userId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.cursor) {
      where.id = { lt: query.cursor };
    }

    const records = await this.prisma.pointRedemption.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        productVariant: {
          include: { product: true },
        },
        productPrice: true,
      },
    });

    const hasMore = records.length > limit;
    const data = hasMore ? records.slice(0, limit) : records;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      data: data.map((r) => ({
        id: r.id,
        status: r.status,
        pointsSpent: r.pointsSpent.toString(),
        vendorRefId: r.vendorRefId,
        customerInfo: r.customerInfo,
        product: {
          id: r.productVariant.product.id,
          name: r.productVariant.product.name,
          imageUrl: r.productVariant.product.imageUrl,
          isVoucher: r.productVariant.product.isVoucher,
          variant: {
            id: r.productVariant.id,
            name: r.productVariant.name,
          },
          price: {
            amount: Number(r.productPrice.sellPrice),
            currency: r.productPrice.currency,
          },
        },
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    };
  }
}
