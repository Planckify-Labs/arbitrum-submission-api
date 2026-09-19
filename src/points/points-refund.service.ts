import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  FulfilmentRefundStatus,
  FulfilmentStatus,
  PointTransactionStatus,
  PointTransactionType,
  Prisma,
  PurchaseStatus,
  RedemptionStatus,
} from "@generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { ValkeyService } from "../valkey/valkey.service";
import { PointsCacheService } from "../valkey/services/points-cache.service";
import { PushService } from "../push/push.service";

export type RefundTargetKind = "purchase" | "redemption";

export interface RefundNotify {
  userId?: string;
  walletAddress?: string;
  productName: string;
}

export interface RefundRequest {
  kind: RefundTargetKind;
  id: string;
  userId: string;
  /** Null when the caller could not derive it safely → held for review. */
  points: bigint | null;
  fiatAmount?: string | null;
  currency?: string | null;
  reason: string;
  vendorError?: string | null;
  source: "auto" | "admin";
  adminId?: string;
  productCode?: string | null;
  notify: RefundNotify;
}

export type RefundResult =
  | { outcome: "credited"; refundId: string; points: bigint }
  | { outcome: "held"; refundId: string; holdReason: string }
  | {
      outcome: "skipped";
      why: "not_refundable" | "already_refunded" | "duplicate";
    };

/** Above this many points an automatic refund waits for a human. */
const DEFAULT_AUTO_CAP = 2_000_000n;
/** More than this many auto refunds per brand per window trips the breaker. */
const DEFAULT_BREAKER_MAX = 20;
const DEFAULT_BREAKER_WINDOW_SEC = 600;

/**
 * Points refunds for orders the vendor could not fulfil. One place owns
 * the balance movement so every caller (poller, redeem worker, admin
 * resolve) gets the same guarantees:
 *
 *   - the target row is flipped with a compare-and-set, so two workers
 *     can't both credit;
 *   - the balance is moved with an atomic increment, never read-then-write;
 *   - the ledger row, the balance and the status flip commit together.
 *
 * `PointTransaction` is a hypertable (no unique index possible), so the
 * CAS on the target row plus the unique `FulfilmentRefund.<target>Id` are
 * the real idempotency guards.
 */
@Injectable()
export class PointsRefundService {
  private readonly logger = new Logger(PointsRefundService.name);
  private readonly autoCap: bigint;
  private readonly breakerMax: number;
  private readonly breakerWindowSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly valkey: ValkeyService,
    private readonly pointsCache: PointsCacheService,
    private readonly pushService: PushService,
    config: ConfigService,
  ) {
    this.autoCap = BigInt(
      config.get<string>("POINTS_REFUND_AUTO_CAP") ??
        DEFAULT_AUTO_CAP.toString(),
    );
    this.breakerMax = Number(
      config.get<string>("POINTS_REFUND_BREAKER_MAX") ?? DEFAULT_BREAKER_MAX,
    );
    this.breakerWindowSec = Number(
      config.get<string>("POINTS_REFUND_BREAKER_WINDOW_SEC") ??
        DEFAULT_BREAKER_WINDOW_SEC,
    );
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const hold = await this.holdReasonFor(req);
    if (hold) return this.hold(req, hold);
    return this.credit(req);
  }

  /** Ops approves a held refund. */
  async approve(refundId: string, adminId: string, note?: string) {
    const row = await this.prisma.fulfilmentRefund.findUnique({
      where: { id: refundId },
    });
    if (!row) throw new NotFoundException("Refund not found");
    if (row.status !== FulfilmentRefundStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `Refund is ${row.status}, not PENDING_REVIEW`,
      );
    }
    const target = this.targetOf(row);
    const notify = await this.notifyFor(target.kind, target.id);

    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.fulfilmentRefund.updateMany({
        where: { id: refundId, status: FulfilmentRefundStatus.PENDING_REVIEW },
        data: {
          status: FulfilmentRefundStatus.COMPLETED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          note,
        },
      });
      if (flipped.count !== 1) {
        throw new ConflictException("Refund was reviewed concurrently");
      }
      await this.flipTargetOrThrow(tx, target.kind, target.id, [
        FulfilmentStatus.FAILED,
        FulfilmentStatus.NEEDS_RECONCILE,
      ]);
      const ptx = await this.moveBalance(tx, {
        userId: row.userId,
        amount: row.points,
        type: PointTransactionType.REFUND,
        referenceType: this.referenceType(target.kind),
        referenceId: target.id,
        metadata: {
          refundId,
          reason: row.reason,
          source: "admin",
          adminId,
          note: note ?? null,
        },
      });
      await tx.fulfilmentRefund.update({
        where: { id: refundId },
        data: {
          pointTransactionId: ptx.id,
          pointTransactionCreatedAt: ptx.createdAt,
        },
      });
      await this.audit(tx, adminId, "FULFILMENT_REFUND_APPROVE", refundId, {
        target,
        points: row.points.toString(),
        note: note ?? null,
      });
    });

    await this.pointsCache.invalidateBalance(row.userId);
    this.pushRefunded(target.kind, target.id, row.userId, notify, row.points);
    return { outcome: "credited" as const, refundId, points: row.points };
  }

  async reject(refundId: string, adminId: string, note: string) {
    const row = await this.prisma.fulfilmentRefund.findUnique({
      where: { id: refundId },
    });
    if (!row) throw new NotFoundException("Refund not found");
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.fulfilmentRefund.updateMany({
        where: { id: refundId, status: FulfilmentRefundStatus.PENDING_REVIEW },
        data: {
          status: FulfilmentRefundStatus.REJECTED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          note,
        },
      });
      if (flipped.count !== 1) {
        throw new ConflictException(
          `Refund is ${row.status}, not PENDING_REVIEW`,
        );
      }
      await this.audit(tx, adminId, "FULFILMENT_REFUND_REJECT", refundId, {
        target: this.targetOf(row),
        note,
      });
    });
    return { id: refundId, status: FulfilmentRefundStatus.REJECTED };
  }

  /**
   * Claw a completed refund back — the order turned out to be delivered
   * after all. Refuses (rather than going negative) when the user has
   * already spent the points; ops then handles it as a debt.
   */
  async reverse(refundId: string, adminId: string, note: string) {
    const row = await this.prisma.fulfilmentRefund.findUnique({
      where: { id: refundId },
    });
    if (!row) throw new NotFoundException("Refund not found");
    if (row.status !== FulfilmentRefundStatus.COMPLETED) {
      throw new ConflictException(`Refund is ${row.status}, not COMPLETED`);
    }
    const target = this.targetOf(row);
    const notify = await this.notifyFor(target.kind, target.id);

    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.fulfilmentRefund.updateMany({
        where: { id: refundId, status: FulfilmentRefundStatus.COMPLETED },
        data: {
          status: FulfilmentRefundStatus.REVERSED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          note,
        },
      });
      if (flipped.count !== 1) {
        throw new ConflictException("Refund was changed concurrently");
      }
      const ptx = await this.moveBalance(tx, {
        userId: row.userId,
        amount: -row.points,
        type: PointTransactionType.ADJUSTMENT,
        referenceType: this.referenceType(target.kind),
        referenceId: target.id,
        metadata: { refundId, reversal: true, adminId, note },
        requireSufficient: true,
      });
      await tx.fulfilmentRefund.update({
        where: { id: refundId },
        data: {
          reversalPointTransactionId: ptx.id,
          reversalPointTransactionCreatedAt: ptx.createdAt,
        },
      });
      // The order was delivered: both legs reflect that now.
      if (target.kind === "purchase") {
        await tx.purchase.update({
          where: { id: target.id },
          data: {
            fulfilmentStatus: FulfilmentStatus.DELIVERED,
            status: PurchaseStatus.COMPLETED,
          },
        });
      } else {
        await tx.pointRedemption.update({
          where: { id: target.id },
          data: {
            fulfilmentStatus: FulfilmentStatus.DELIVERED,
            status: RedemptionStatus.COMPLETED,
          },
        });
      }
      await this.audit(tx, adminId, "FULFILMENT_REFUND_REVERSE", refundId, {
        target,
        points: row.points.toString(),
        note,
      });
    });

    await this.pointsCache.invalidateBalance(row.userId);
    void this.pushService
      .sendFulfilmentPush({
        ...notify,
        kind: target.kind,
        id: target.id,
        stage: "refund_reversed",
        points: row.points,
      })
      .catch((err) => this.warnPush(target.id, err));
    return { id: refundId, status: FulfilmentRefundStatus.REVERSED };
  }

  // ── internals ──────────────────────────────────────────────────────

  private async holdReasonFor(req: RefundRequest): Promise<string | null> {
    if (req.points === null || req.points <= 0n) return "unknown_amount";
    if (req.source === "admin") return null;
    if (req.points > this.autoCap) return "over_cap";
    if (await this.breakerTripped(req.productCode)) return "breaker";
    return null;
  }

  /**
   * N failures for one brand in a short window is a vendor outage, not N
   * unlucky buyers. Holding lets the poller keep retrying — most of those
   * users would rather have the product in half an hour than a refund.
   */
  private async breakerTripped(productCode?: string | null): Promise<boolean> {
    if (!productCode) return false;
    const bucket = Math.floor(Date.now() / 1000 / this.breakerWindowSec);
    const key = `fulfilment:refund-breaker:${productCode}:${bucket}`;
    try {
      const count = await this.valkey.incr(key);
      if (count === 1) await this.valkey.expire(key, this.breakerWindowSec * 2);
      if (count > this.breakerMax) {
        this.logger.warn(
          `[refund] breaker tripped for ${productCode}: ${count} refunds in ${this.breakerWindowSec}s`,
        );
        return true;
      }
      return false;
    } catch (err) {
      // Cache down: fail open on the breaker; the cap still applies.
      this.logger.warn(
        `[refund] breaker check failed, continuing: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async hold(
    req: RefundRequest,
    holdReason: string,
  ): Promise<RefundResult> {
    try {
      const row = await this.prisma.fulfilmentRefund.create({
        data: {
          ...this.targetColumns(req.kind, req.id),
          userId: req.userId,
          points: req.points ?? 0n,
          fiatAmount: req.fiatAmount ?? null,
          currency: req.currency ?? null,
          status: FulfilmentRefundStatus.PENDING_REVIEW,
          source: req.source,
          reason: req.reason,
          vendorError: req.vendorError ?? null,
          holdReason,
          productCode: req.productCode ?? null,
        },
      });
      this.logger.warn(
        `[refund] held ${req.kind} ${req.id} for review (${holdReason}, ${req.points ?? "?"} pts)`,
      );
      void this.pushService
        .sendFulfilmentPush({
          ...req.notify,
          kind: req.kind,
          id: req.id,
          stage: "refund_pending",
        })
        .catch((err) => this.warnPush(req.id, err));
      return { outcome: "held", refundId: row.id, holdReason };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        return { outcome: "skipped", why: "duplicate" };
      }
      throw err;
    }
  }

  private async credit(req: RefundRequest): Promise<RefundResult> {
    const points = req.points as bigint;
    let refundId: string | null = null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const flipped = await this.flipTarget(tx, req.kind, req.id, [
          FulfilmentStatus.FAILED,
        ]);
        if (!flipped) {
          refundId = null;
          return;
        }
        const ptx = await this.moveBalance(tx, {
          userId: req.userId,
          amount: points,
          type: PointTransactionType.REFUND,
          referenceType: this.referenceType(req.kind),
          referenceId: req.id,
          metadata: {
            reason: req.reason,
            vendorError: req.vendorError ?? null,
            fiatAmount: req.fiatAmount ?? null,
            currency: req.currency ?? null,
            source: req.source,
            adminId: req.adminId ?? null,
          },
        });
        const row = await tx.fulfilmentRefund.create({
          data: {
            ...this.targetColumns(req.kind, req.id),
            userId: req.userId,
            points,
            fiatAmount: req.fiatAmount ?? null,
            currency: req.currency ?? null,
            status: FulfilmentRefundStatus.COMPLETED,
            source: req.source,
            reason: req.reason,
            vendorError: req.vendorError ?? null,
            productCode: req.productCode ?? null,
            reviewedBy: req.adminId ?? null,
            reviewedAt: req.adminId ? new Date() : null,
            pointTransactionId: ptx.id,
            pointTransactionCreatedAt: ptx.createdAt,
          },
        });
        refundId = row.id;
        if (req.adminId) {
          await this.audit(
            tx,
            req.adminId,
            "FULFILMENT_REFUND_MANUAL",
            row.id,
            {
              target: { kind: req.kind, id: req.id },
              points: points.toString(),
              reason: req.reason,
            },
          );
        }
      });
    } catch (err) {
      // A held row already exists for this target (unique index) — the
      // whole transaction, including the balance credit, rolled back.
      if (this.isUniqueViolation(err)) {
        return { outcome: "skipped", why: "duplicate" };
      }
      throw err;
    }

    if (!refundId) {
      const current = await this.currentFulfilmentStatus(req.kind, req.id);
      return {
        outcome: "skipped",
        why:
          current === FulfilmentStatus.REFUNDED
            ? "already_refunded"
            : "not_refundable",
      };
    }

    await this.pointsCache.invalidateBalance(req.userId);
    this.logger.log(
      `[refund] credited ${points} pts to ${req.userId} for ${req.kind} ${req.id}`,
    );
    this.pushRefunded(req.kind, req.id, req.userId, req.notify, points);
    return { outcome: "credited", refundId, points };
  }

  /**
   * The balance movement. `increment` is one atomic statement, so a
   * refund racing a spend can't lose either update; `balanceBefore` is
   * derived from the returned row rather than read separately.
   */
  private async moveBalance(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      amount: bigint;
      type: PointTransactionType;
      referenceType: string;
      referenceId: string;
      metadata: Record<string, unknown>;
      requireSufficient?: boolean;
    },
  ) {
    if (input.requireSufficient && input.amount < 0n) {
      const guarded = await tx.pointBalance.updateMany({
        where: { userId: input.userId, balance: { gte: -input.amount } },
        data: { balance: { increment: input.amount } },
      });
      if (guarded.count !== 1) {
        throw new ConflictException(
          "Insufficient point balance to reverse this refund",
        );
      }
    } else {
      await tx.pointBalance.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, balance: input.amount },
        update: { balance: { increment: input.amount } },
      });
    }
    const after = await tx.pointBalance.findUniqueOrThrow({
      where: { userId: input.userId },
      select: { balance: true },
    });
    return tx.pointTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        status: PointTransactionStatus.COMPLETED,
        amount: input.amount,
        balanceBefore: after.balance - input.amount,
        balanceAfter: after.balance,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
      select: { id: true, createdAt: true },
    });
  }

  /** Compare-and-set on the target's fulfilment (and money) status. */
  private async flipTarget(
    tx: Prisma.TransactionClient,
    kind: RefundTargetKind,
    id: string,
    from: FulfilmentStatus[],
  ): Promise<boolean> {
    if (kind === "purchase") {
      const r = await tx.purchase.updateMany({
        where: { id, fulfilmentStatus: { in: from } },
        data: {
          fulfilmentStatus: FulfilmentStatus.REFUNDED,
          status: PurchaseStatus.REFUNDED,
        },
      });
      return r.count === 1;
    }
    const r = await tx.pointRedemption.updateMany({
      where: { id, fulfilmentStatus: { in: from } },
      data: {
        fulfilmentStatus: FulfilmentStatus.REFUNDED,
        status: RedemptionStatus.REFUNDED,
      },
    });
    return r.count === 1;
  }

  private async flipTargetOrThrow(
    tx: Prisma.TransactionClient,
    kind: RefundTargetKind,
    id: string,
    from: FulfilmentStatus[],
  ) {
    if (!(await this.flipTarget(tx, kind, id, from))) {
      throw new ConflictException(
        `${kind} ${id} is not in a refundable state (${from.join("/")})`,
      );
    }
  }

  private async currentFulfilmentStatus(kind: RefundTargetKind, id: string) {
    const row =
      kind === "purchase"
        ? await this.prisma.purchase.findUnique({
            where: { id },
            select: { fulfilmentStatus: true },
          })
        : await this.prisma.pointRedemption.findUnique({
            where: { id },
            select: { fulfilmentStatus: true },
          });
    return row?.fulfilmentStatus ?? null;
  }

  private async notifyFor(
    kind: RefundTargetKind,
    id: string,
  ): Promise<RefundNotify> {
    if (kind === "purchase") {
      const p = await this.prisma.purchase.findUnique({
        where: { id },
        select: {
          bookingOrder: { select: { walletAddress: true } },
          productVariant: { select: { product: { select: { name: true } } } },
        },
      });
      return {
        walletAddress: p?.bookingOrder.walletAddress,
        productName: p?.productVariant.product.name ?? "your order",
      };
    }
    const r = await this.prisma.pointRedemption.findUnique({
      where: { id },
      select: {
        userId: true,
        productVariant: {
          select: { name: true, product: { select: { name: true } } },
        },
      },
    });
    return {
      userId: r?.userId,
      productName: r
        ? `${r.productVariant.product.name} ${r.productVariant.name}`.trim()
        : "your order",
    };
  }

  private pushRefunded(
    kind: RefundTargetKind,
    id: string,
    userId: string,
    notify: RefundNotify,
    points: bigint,
  ) {
    void this.pushService
      .sendFulfilmentPush({
        userId,
        ...notify,
        kind,
        id,
        stage: "refunded",
        points,
      })
      .catch((err) => this.warnPush(id, err));
  }

  private warnPush(id: string, err: unknown) {
    this.logger.warn(
      `[refund] push failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  private async audit(
    tx: Prisma.TransactionClient,
    adminId: string,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await tx.adminAuditLog.create({
      data: {
        adminUser: { connect: { id: adminId } },
        action,
        resource: "FulfilmentRefund",
        resourceId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private targetOf(row: {
    purchaseId: string | null;
    redemptionId: string | null;
  }) {
    if (row.purchaseId)
      return { kind: "purchase" as const, id: row.purchaseId };
    if (row.redemptionId)
      return { kind: "redemption" as const, id: row.redemptionId };
    throw new ConflictException("Refund row has no target");
  }

  private targetColumns(kind: RefundTargetKind, id: string) {
    return kind === "purchase" ? { purchaseId: id } : { redemptionId: id };
  }

  private referenceType(kind: RefundTargetKind) {
    return kind === "purchase" ? "PURCHASE" : "POINT_REDEMPTION";
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    );
  }
}
