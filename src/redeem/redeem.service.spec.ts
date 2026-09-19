import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { ProductInputValidatorService } from "../products/services/product-input-validator.service";
import type { PointsCacheService } from "../valkey/services/points-cache.service";
import type { VCGamersService } from "../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import type { Queue } from "bullmq";
// PushService (reached via FulfilmentService) pulls in the ESM expo SDK.
jest.mock("expo-server-sdk", () => ({ Expo: class {} }));

import { RedeemService } from "./redeem.service";
import type { FulfilmentService } from "../fulfilment/fulfilment.service";

function buildHarness(
  opts: {
    user?: Record<string, unknown> | null;
    variant?: Record<string, unknown> | null;
    price?: Record<string, unknown> | null;
    redemption?: Record<string, unknown> | null;
    redemptions?: Record<string, unknown>[];
    balance?: { balance: bigint } | null;
    validateThrows?: boolean;
  } = {},
) {
  const txCalls = {
    pointBalance: {
      findUnique: jest.fn(async () => opts.balance ?? null),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
    },
    pointTransaction: {
      create: jest.fn(async () => ({
        id: "ptx_1",
        createdAt: new Date(),
      })),
      update: jest.fn(async () => ({})),
    },
    pointRedemption: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "red_1",
        createdAt: new Date(),
        ...data,
      })),
    },
  };
  const tx: Record<string, unknown> = {
    pointBalance: txCalls.pointBalance,
    pointTransaction: txCalls.pointTransaction,
    pointRedemption: txCalls.pointRedemption,
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    user: { findUnique: jest.fn(async () => opts.user ?? null) },
    productVariant: { findUnique: jest.fn(async () => opts.variant ?? null) },
    productPrice: { findFirst: jest.fn(async () => opts.price ?? null) },
    pointRedemption: {
      findFirst: jest.fn(async () => opts.redemption ?? null),
      findUnique: jest.fn(async () => opts.redemption ?? null),
      findMany: jest.fn(async () => opts.redemptions ?? []),
      count: jest.fn(async () => opts.redemptions?.length ?? 0),
      update: jest.fn(async () => ({})),
    },
  } as unknown as PrismaService;

  const productInputValidator = {
    validateCustomerInfo: jest.fn(async (_p: string, info: unknown) => {
      await Promise.resolve();
      if (opts.validateThrows) throw new BadRequestException("invalid");
      return info ?? {};
    }),
  } as unknown as ProductInputValidatorService;

  const pointsCache = {
    invalidateBalance: jest.fn(async () => undefined),
  } as unknown as PointsCacheService;

  const vcGamersService = {
    getOrderStatus: jest.fn(async () => ({ success: false, statusCode: 500 })),
  } as unknown as VCGamersService;

  const queue = {
    add: jest.fn(async () => ({ id: "j_1" })),
  } as unknown as Queue;

  const fulfilment = {
    check: jest.fn(async () => "DELIVERED"),
  } as unknown as FulfilmentService;

  const svc = new RedeemService(
    prisma,
    productInputValidator,
    pointsCache,
    vcGamersService,
    fulfilment,
    queue,
  );
  return {
    svc,
    prisma,
    queue,
    pointsCache,
    vcGamersService,
    fulfilment,
    txCalls,
  };
}

const validDto = () => ({
  productVariantId: "pv_1",
  productPriceId: "pp_1",
  customerInfo: { phone: "081" },
});

describe("RedeemService.executeRedeem prerequisite checks", () => {
  it("404s when user missing", async () => {
    const { svc } = buildHarness({ user: null });
    await expect(
      svc.executeRedeem("u1", validDto() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("404s when variant missing", async () => {
    const { svc } = buildHarness({
      user: { id: "u1" },
      variant: null,
    });
    await expect(
      svc.executeRedeem("u1", validDto() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects inactive variant", async () => {
    const { svc } = buildHarness({
      user: { id: "u1" },
      variant: {
        id: "pv",
        isActive: false,
        product: { id: "p", isActive: true },
      },
    });
    await expect(
      svc.executeRedeem("u1", validDto() as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects inactive product", async () => {
    const { svc } = buildHarness({
      user: { id: "u1" },
      variant: {
        id: "pv",
        isActive: true,
        product: { id: "p", isActive: false },
      },
    });
    await expect(
      svc.executeRedeem("u1", validDto() as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s when product price missing for variant", async () => {
    const { svc } = buildHarness({
      user: { id: "u1" },
      variant: {
        id: "pv",
        isActive: true,
        product: { id: "p", isActive: true },
      },
      price: null,
    });
    await expect(
      svc.executeRedeem("u1", validDto() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("propagates customer-info validation errors", async () => {
    const { svc } = buildHarness({
      user: { id: "u1" },
      variant: {
        id: "pv",
        isActive: true,
        product: { id: "p", isActive: true },
      },
      price: { id: "pp", sellPrice: "1000", currency: "IDR", vendor: {} },
      validateThrows: true,
    });
    await expect(
      svc.executeRedeem("u1", validDto() as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("RedeemService.executeRedeem balance gating", () => {
  it("rejects with 400 when balance is insufficient", async () => {
    const { svc } = buildHarness({
      user: { id: "u1" },
      variant: {
        id: "pv",
        isActive: true,
        product: { id: "p", isActive: true },
      },
      price: { id: "pp", sellPrice: "5000", currency: "IDR", vendor: {} },
      balance: { balance: BigInt(100) },
    });
    await expect(
      svc.executeRedeem("u1", validDto() as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates a SPEND tx and PENDING redemption when balance suffices", async () => {
    const { svc, queue, pointsCache, txCalls } = buildHarness({
      user: { id: "u1" },
      variant: {
        id: "pv",
        isActive: true,
        product: { id: "p", isActive: true },
      },
      price: { id: "pp", sellPrice: "5000", currency: "IDR", vendor: {} },
      balance: { balance: BigInt(100_000) },
    });
    const out = await svc.executeRedeem("u1", validDto() as never);
    expect(txCalls.pointTransaction.create).toHaveBeenCalled();
    expect(txCalls.pointRedemption.create).toHaveBeenCalled();
    expect(pointsCache.invalidateBalance).toHaveBeenCalledWith("u1");
    expect(queue.add).toHaveBeenCalledWith(
      "process-redemption",
      expect.objectContaining({ redemptionId: "red_1" }),
      expect.objectContaining({ attempts: 5 }),
    );
    expect(out.status).toBe("PENDING");
  });

  it("creates a fresh balance row when user has none yet", async () => {
    const { svc } = buildHarness({
      user: { id: "u1" },
      variant: {
        id: "pv",
        isActive: true,
        product: { id: "p", isActive: true },
      },
      price: { id: "pp", sellPrice: "0", currency: "IDR", vendor: {} },
      balance: null,
    });
    await svc.executeRedeem("u1", validDto() as never);
  });
});

describe("RedeemService.getRedeemById", () => {
  it("404s when missing or not owned", async () => {
    const { svc } = buildHarness({ redemption: null });
    await expect(svc.getRedeemById("u1", "red_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  const delivered = (overrides: Record<string, unknown> = {}) => ({
    id: "red_1",
    userId: "u1",
    status: "COMPLETED",
    vendorRefId: "v_ref",
    vendorResponse: { data: { status: 2, detail: { voucher_code: "ABC123" } } },
    fulfilmentStatus: "DELIVERED",
    fulfilmentError: null,
    delivery: {
      kind: "voucher",
      primary: { label: "Code", value: "ABC123", copyable: true },
      fields: [],
      raw: "ABC123",
      parse: "heuristic",
      parserId: "heuristic@1",
    },
    deliveryRaw: "ABC123",
    expectedBy: null,
    fulfilledAt: new Date(),
    vendorLastCheckedAt: new Date(),
    refund: null,
    pointsSpent: BigInt(1000),
    customerInfo: {},
    productVariant: {
      id: "pv",
      name: "X",
      product: {
        id: "p",
        name: "P",
        imageUrl: null,
        isVoucher: true,
        deliveryType: null,
      },
    },
    productPrice: { sellPrice: "1000", currency: "IDR" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it("returns the legacy voucherCode and the fulfilment block", async () => {
    const { svc, fulfilment } = buildHarness({ redemption: delivered() });
    const out = await svc.getRedeemById("u1", "red_1");
    expect(out.voucherCode).toBe("ABC123");
    expect(out.fulfilment.status).toBe("DELIVERED");
    expect(out.fulfilment.delivery?.primary?.value).toBe("ABC123");
    expect(out.product.deliveryType).toBe("VOUCHER_CODE");
    expect(fulfilment.check).not.toHaveBeenCalled();
  });

  it("asks the vendor through the state machine while the order is open", async () => {
    const { svc, fulfilment } = buildHarness({
      redemption: delivered({
        fulfilmentStatus: "SUBMITTED",
        delivery: null,
        deliveryRaw: null,
        vendorLastCheckedAt: null,
      }),
    });
    await svc.getRedeemById("u1", "red_2");
    expect(fulfilment.check).toHaveBeenCalledWith("redemption", "red_2", {
      reschedule: false,
    });
  });
});

describe("RedeemService.getRedeemStatus / getRedeemHistory", () => {
  it("getRedeemStatus 404s when missing", async () => {
    const { svc } = buildHarness({ redemption: null });
    await expect(svc.getRedeemStatus("u1", "red_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("getRedeemHistory paginates with hasMore=true on overflow", async () => {
    const records = Array.from({ length: 21 }, (_, i) => ({
      id: `red_${i}`,
      status: "COMPLETED",
      pointsSpent: BigInt(1000),
      vendorRefId: null,
      customerInfo: {},
      productVariant: {
        id: "pv",
        name: "X",
        product: { id: "p", name: "P", imageUrl: null, isVoucher: true },
      },
      productPrice: { sellPrice: "1000", currency: "IDR" },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const { svc } = buildHarness({ redemptions: records });
    const out = await svc.getRedeemHistory("u1", { limit: 20 } as never);
    expect(out.hasMore).toBe(true);
    expect(out.data).toHaveLength(20);
    expect(out.nextCursor).toBe(out.data[19].id);
  });
});

describe("RedeemService admin endpoints", () => {
  it("findOneAdmin 404s when missing", async () => {
    const { svc } = buildHarness({ redemption: null });
    await expect(svc.findOneAdmin("red_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("findAllAdmin paginates with skip + cursor + status filters", async () => {
    const { svc, prisma } = buildHarness({ redemptions: [] });
    await svc.findAllAdmin({
      limit: 10,
      skip: 30,
      status: "COMPLETED",
      userId: "u_x",
      cursor: "ignored-when-skip-set",
    } as never);
    const findMany = (prisma.pointRedemption.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findMany.skip).toBe(30);
    expect(findMany.where.status).toBe("COMPLETED");
    expect(findMany.where.userId).toBe("u_x");
    // skip > 0 supersedes cursor
    expect(findMany.where.id).toBeUndefined();
  });
});
