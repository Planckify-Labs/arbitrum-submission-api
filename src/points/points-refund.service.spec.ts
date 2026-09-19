import { ConflictException } from "@nestjs/common";
import { Prisma } from "@generated/prisma";

jest.mock("expo-server-sdk", () => ({ Expo: class {} }));

import { PointsRefundService, RefundRequest } from "./points-refund.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ValkeyService } from "../valkey/valkey.service";
import type { PointsCacheService } from "../valkey/services/points-cache.service";
import type { PushService } from "../push/push.service";
import type { ConfigService } from "@nestjs/config";

type AnyFn = jest.Mock;

function buildHarness(
  opts: {
    flipCount?: number;
    balanceAfter?: bigint;
    breakerCount?: number;
    createThrowsUnique?: boolean;
    guardedCount?: number;
    refundRow?: Record<string, unknown> | null;
    currentStatus?: string;
  } = {},
) {
  const tx = {
    purchase: {
      updateMany: jest.fn(async () => ({ count: opts.flipCount ?? 1 })),
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => ({
        fulfilmentStatus: opts.currentStatus ?? "FAILED",
      })),
    },
    pointRedemption: {
      updateMany: jest.fn(async () => ({ count: opts.flipCount ?? 1 })),
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => ({
        fulfilmentStatus: opts.currentStatus ?? "FAILED",
      })),
    },
    pointBalance: {
      upsert: jest.fn(async () => ({ balance: opts.balanceAfter ?? 150000n })),
      updateMany: jest.fn(async () => ({ count: opts.guardedCount ?? 1 })),
      findUniqueOrThrow: jest.fn(async () => ({
        balance: opts.balanceAfter ?? 150000n,
      })),
    },
    pointTransaction: {
      create: jest.fn(async () => ({
        id: "ptx_1",
        createdAt: new Date("2026-09-19T00:00:00Z"),
      })),
    },
    fulfilmentRefund: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        if (opts.createThrowsUnique) {
          throw new Prisma.PrismaClientKnownRequestError("dup", {
            code: "P2002",
            clientVersion: "x",
          });
        }
        return { id: "ref_1", ...args.data };
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => opts.refundRow ?? null),
    },
    adminAuditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
      cb(tx),
    ),
  } as unknown as PrismaService;

  const valkey = {
    incr: jest.fn(async () => opts.breakerCount ?? 1),
    expire: jest.fn(async () => true),
  } as unknown as ValkeyService;
  const pointsCache = {
    invalidateBalance: jest.fn(async () => undefined),
  } as unknown as PointsCacheService;
  const push = {
    sendFulfilmentPush: jest.fn(async () => undefined),
  } as unknown as PushService;
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const svc = new PointsRefundService(
    prisma,
    valkey,
    pointsCache,
    push,
    config,
  );
  return { svc, tx, prisma, valkey, pointsCache, push };
}

const req = (overrides: Partial<RefundRequest> = {}): RefundRequest => ({
  kind: "purchase",
  id: "pur_1",
  userId: "u1",
  points: 50000n,
  fiatAmount: "50000",
  currency: "IDR",
  reason: "vendor rejected: 422: invalid user id",
  source: "auto",
  productCode: "MLBB",
  notify: { walletAddress: "0xabc", productName: "MLBB 86 Diamonds" },
  ...overrides,
});

describe("PointsRefundService.refund — credit path", () => {
  it("flips the target with a CAS, moves the balance atomically, and writes ledger + refund in one transaction", async () => {
    const { svc, tx, prisma, pointsCache, push } = buildHarness({
      balanceAfter: 150000n,
    });
    const out = await svc.refund(req());

    expect(out).toEqual({
      outcome: "credited",
      refundId: "ref_1",
      points: 50000n,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // CAS: only a FAILED row may be refunded; both legs flip together.
    expect(tx.purchase.updateMany).toHaveBeenCalledWith({
      where: { id: "pur_1", fulfilmentStatus: { in: ["FAILED"] } },
      data: { fulfilmentStatus: "REFUNDED", status: "REFUNDED" },
    });
    // Atomic increment, never read-then-write.
    expect(tx.pointBalance.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", balance: 50000n },
      update: { balance: { increment: 50000n } },
    });
    const ledger = (tx.pointTransaction.create as AnyFn).mock.calls[0][0].data;
    expect(ledger).toMatchObject({
      userId: "u1",
      type: "REFUND",
      status: "COMPLETED",
      amount: 50000n,
      balanceBefore: 100000n,
      balanceAfter: 150000n,
      referenceType: "PURCHASE",
      referenceId: "pur_1",
    });
    const refundRow = (tx.fulfilmentRefund.create as AnyFn).mock.calls[0][0]
      .data;
    expect(refundRow).toMatchObject({
      purchaseId: "pur_1",
      status: "COMPLETED",
      points: 50000n,
      pointTransactionId: "ptx_1",
    });
    expect(pointsCache.invalidateBalance).toHaveBeenCalledWith("u1");
    await new Promise((r) => setImmediate(r));
    expect(push.sendFulfilmentPush).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "refunded",
        points: 50000n,
        kind: "purchase",
        id: "pur_1",
      }),
    );
  });

  it("does nothing when the CAS loses (already refunded by another worker)", async () => {
    const { svc, tx } = buildHarness({
      flipCount: 0,
      currentStatus: "REFUNDED",
    });
    const out = await svc.refund(req());
    expect(out).toEqual({ outcome: "skipped", why: "already_refunded" });
    expect(tx.pointBalance.upsert).not.toHaveBeenCalled();
    expect(tx.pointTransaction.create).not.toHaveBeenCalled();
  });

  it("a held row already existing (unique index) rolls the whole credit back", async () => {
    const { svc } = buildHarness({ createThrowsUnique: true });
    const out = await svc.refund(req());
    expect(out).toEqual({ outcome: "skipped", why: "duplicate" });
  });

  it("redemptions flip the PointRedemption row and reference POINT_REDEMPTION", async () => {
    const { svc, tx } = buildHarness();
    await svc.refund(
      req({
        kind: "redemption",
        id: "red_1",
        notify: { userId: "u1", productName: "X" },
      }),
    );
    expect(tx.pointRedemption.updateMany).toHaveBeenCalled();
    expect(tx.purchase.updateMany).not.toHaveBeenCalled();
    expect(
      (tx.pointTransaction.create as AnyFn).mock.calls[0][0].data.referenceType,
    ).toBe("POINT_REDEMPTION");
  });
});

describe("PointsRefundService.refund — holds", () => {
  it("over the auto cap → PENDING_REVIEW, no balance movement, 'in review' push", async () => {
    const { svc, tx, push } = buildHarness();
    const out = await svc.refund(req({ points: 2_500_000n }));
    expect(out).toEqual({
      outcome: "held",
      refundId: "ref_1",
      holdReason: "over_cap",
    });
    expect(tx.pointBalance.upsert).not.toHaveBeenCalled();
    expect(tx.purchase.updateMany).not.toHaveBeenCalled();
    expect(
      (tx.fulfilmentRefund.create as AnyFn).mock.calls[0][0].data.status,
    ).toBe("PENDING_REVIEW");
    await new Promise((r) => setImmediate(r));
    expect(push.sendFulfilmentPush).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "refund_pending" }),
    );
  });

  it("the per-brand breaker holds the 21st refund in a window", async () => {
    const { svc, valkey } = buildHarness({ breakerCount: 21 });
    const out = await svc.refund(req());
    expect(out).toMatchObject({ outcome: "held", holdReason: "breaker" });
    expect((valkey.incr as AnyFn).mock.calls[0][0]).toMatch(
      /^fulfilment:refund-breaker:MLBB:/,
    );
  });

  it("an amount that could not be derived is held, never guessed", async () => {
    const { svc } = buildHarness();
    const out = await svc.refund(req({ points: null }));
    expect(out).toMatchObject({
      outcome: "held",
      holdReason: "unknown_amount",
    });
  });

  it("an admin-sourced refund bypasses cap and breaker", async () => {
    const { svc } = buildHarness({ breakerCount: 99 });
    const out = await svc.refund(
      req({ points: 9_000_000n, source: "admin", adminId: "ops" }),
    );
    expect(out.outcome).toBe("credited");
  });

  it("a second hold for the same target is a no-op (unique index)", async () => {
    const { svc } = buildHarness({ createThrowsUnique: true });
    const out = await svc.refund(req({ points: 2_500_000n }));
    expect(out).toEqual({ outcome: "skipped", why: "duplicate" });
  });
});

describe("PointsRefundService.approve / reject / reverse", () => {
  const held = {
    id: "ref_1",
    purchaseId: "pur_1",
    redemptionId: null,
    userId: "u1",
    points: 2_500_000n,
    status: "PENDING_REVIEW",
    reason: "vendor rejected",
  };

  it("approve credits under a CAS on both the refund row and the target", async () => {
    const { svc, tx } = buildHarness({ refundRow: held });
    (tx.purchase.findUnique as AnyFn).mockResolvedValue({
      bookingOrder: { walletAddress: "0xabc" },
      productVariant: { product: { name: "X" } },
    });
    const out = await svc.approve("ref_1", "ops", "checked with vendor");
    expect(out).toMatchObject({ outcome: "credited", points: 2_500_000n });
    expect(tx.fulfilmentRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ref_1", status: "PENDING_REVIEW" },
      }),
    );
    expect(tx.purchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "pur_1",
          fulfilmentStatus: { in: ["FAILED", "NEEDS_RECONCILE"] },
        },
      }),
    );
    expect(tx.pointBalance.upsert).toHaveBeenCalled();
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "FULFILMENT_REFUND_APPROVE" }),
      }),
    );
  });

  it("approve refuses a row that is not pending", async () => {
    const { svc } = buildHarness({
      refundRow: { ...held, status: "COMPLETED" },
    });
    await expect(svc.approve("ref_1", "ops")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("reverse debits with a sufficiency guard and refuses to go negative", async () => {
    const completed = { ...held, status: "COMPLETED", points: 50000n };
    const ok = buildHarness({
      refundRow: completed,
      guardedCount: 1,
      balanceAfter: 0n,
    });
    (ok.tx.purchase.findUnique as AnyFn).mockResolvedValue({
      bookingOrder: { walletAddress: "0xabc" },
      productVariant: { product: { name: "X" } },
    });
    await ok.svc.reverse("ref_1", "ops", "delivered after refund");
    expect(ok.tx.pointBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", balance: { gte: 50000n } },
      data: { balance: { increment: -50000n } },
    });
    expect(
      (ok.tx.pointTransaction.create as AnyFn).mock.calls[0][0].data,
    ).toMatchObject({
      type: "ADJUSTMENT",
      amount: -50000n,
    });
    // Both legs now say delivered.
    expect(ok.tx.purchase.update).toHaveBeenCalledWith({
      where: { id: "pur_1" },
      data: { fulfilmentStatus: "DELIVERED", status: "COMPLETED" },
    });

    const broke = buildHarness({ refundRow: completed, guardedCount: 0 });
    (broke.tx.purchase.findUnique as AnyFn).mockResolvedValue({
      bookingOrder: { walletAddress: "0xabc" },
      productVariant: { product: { name: "X" } },
    });
    await expect(broke.svc.reverse("ref_1", "ops", "n")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(broke.tx.pointTransaction.create).not.toHaveBeenCalled();
  });

  it("reject only flips a pending row and audits", async () => {
    const { svc, tx } = buildHarness({ refundRow: held });
    await svc.reject("ref_1", "ops", "buyer already got it");
    expect(tx.fulfilmentRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ref_1", status: "PENDING_REVIEW" },
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );
    expect(tx.pointBalance.upsert).not.toHaveBeenCalled();
  });
});
