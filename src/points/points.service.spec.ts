import { BadRequestException, NotFoundException, ConflictException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { ExchangeRateService } from "../exchange-rate/exchange-rate.service";
import type { PointsCacheService } from "../valkey/services/points-cache.service";
import type { ReferenceIdService } from "../reference-id/reference-id.service";
import type { Queue } from "bullmq";
import { PointsService } from "./points.service";

function buildHarness(opts: {
  user?: Record<string, unknown> | null;
  token?: Record<string, unknown> | null;
  blockchain?: Record<string, unknown> | null;
  contract?: Record<string, unknown> | null;
  priceConfig?: Record<string, unknown> | null;
  exchangeRate?: { rate: number } | null;
  balance?: { balance: bigint } | null;
  refIdCreateError?: { code: string };
  existingPointTx?: Record<string, unknown> | null;
  existingByHash?: Record<string, unknown> | null;
  walletLinks?: { walletAddress: string }[];
} = {}) {
  const txCalls = {
    pointBalance: {
      findUnique: jest.fn(async () => opts.balance ?? null),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
    },
    pointTransaction: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ptx_1",
        createdAt: new Date(),
        ...data,
      })),
      update: jest.fn(async () => ({})),
    },
    pointPriceConfig: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({ id: "pc_new" })),
    },
  };
  const tx: Record<string, unknown> = {
    pointBalance: txCalls.pointBalance,
    pointTransaction: txCalls.pointTransaction,
    pointPriceConfig: txCalls.pointPriceConfig,
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    user: {
      findUnique: jest.fn(async () => opts.user ?? null),
      findMany: jest.fn(async () => []),
    },
    token: { findUnique: jest.fn(async () => opts.token ?? null) },
    blockchain: { findUnique: jest.fn(async () => opts.blockchain ?? null) },
    smartContract: { findFirst: jest.fn(async () => opts.contract ?? null) },
    pointPriceConfig: {
      findFirst: jest.fn(async () => opts.priceConfig ?? null),
    },
    pointBalance: { findUnique: jest.fn(async () => opts.balance ?? null) },
    pointTransaction: {
      findFirst: jest.fn(
        async ({ where }: { where: { txHash?: string; refId?: string } }) => {
          await Promise.resolve();
          if (where.txHash) return opts.existingByHash ?? null;
          return opts.existingPointTx ?? null;
        },
      ),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ptx_top",
        createdAt: new Date(),
        ...data,
      })),
      aggregate: jest.fn(async () => ({ _sum: { amount: BigInt(0) } })),
    },
    referenceId: {
      create: jest.fn(async () => {
        await Promise.resolve();
        if (opts.refIdCreateError) {
          throw Object.assign(new Error("dup"), opts.refIdCreateError);
        }
        return { id: "ri" };
      }),
      update: jest.fn(async () => ({})),
    },
    walletAccountLink: {
      findMany: jest.fn(async () => opts.walletLinks ?? []),
    },
  } as unknown as PrismaService;

  const exchangeRateService = {
    findLatest: jest.fn(async () => opts.exchangeRate ?? null),
  } as unknown as ExchangeRateService;

  const pointsCache = {
    getPointPrice: jest.fn(
      async (
        _t: string,
        _c: string,
        fallback: () => unknown,
      ) => fallback(),
    ),
    getPointConfig: jest.fn(async (_c: string, fallback: () => unknown) => fallback()),
    getPointBalance: jest.fn(async (_u: string, fallback: () => unknown) => fallback()),
    invalidateBalance: jest.fn(async () => undefined),
    invalidateConfig: jest.fn(async () => undefined),
    invalidatePrices: jest.fn(async () => undefined),
  } as unknown as PointsCacheService;

  const referenceIdService = {} as ReferenceIdService;

  const queue = {
    add: jest.fn(async () => ({ id: "job_1" })),
  } as unknown as Queue;

  // Patch Prisma.PrismaClientKnownRequestError instanceof check for catch block
  const { Prisma } = require("@generated/prisma");
  if (opts.refIdCreateError) {
    (prisma.referenceId.create as jest.Mock).mockImplementation(async () => {
      await Promise.resolve();
      const err = new Prisma.PrismaClientKnownRequestError("dup", {
        code: opts.refIdCreateError!.code,
        clientVersion: "0",
      });
      throw err;
    });
  }

  const svc = new PointsService(
    prisma,
    exchangeRateService,
    pointsCache,
    referenceIdService,
    queue,
  );
  return { svc, prisma, queue, pointsCache, exchangeRateService, txCalls };
}

describe("PointsService.getPointPrice", () => {
  it("rejects when token missing", async () => {
    const { svc } = buildHarness({ token: null });
    await expect(
      svc.getPointPrice({ tokenId: "tk_x", currency: "IDR" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects inactive or non-stablecoin token", async () => {
    const { svc: svcInactive } = buildHarness({
      token: { isActive: false, isStablecoin: true, symbol: "X" },
    });
    await expect(
      svcInactive.getPointPrice({ tokenId: "tk_x", currency: "IDR" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const { svc: svcNonStable } = buildHarness({
      token: { isActive: true, isStablecoin: false, symbol: "X" },
    });
    await expect(
      svcNonStable.getPointPrice({ tokenId: "tk_x", currency: "IDR" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when no priceConfig is active for the currency", async () => {
    const { svc } = buildHarness({
      token: { isActive: true, isStablecoin: true, symbol: "USDC" },
      priceConfig: null,
    });
    await expect(
      svc.getPointPrice({ tokenId: "tk_x", currency: "IDR" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("uses 1:1 rate when token is pegged to the requested currency", async () => {
    const { svc, exchangeRateService } = buildHarness({
      token: {
        id: "tk_idrx",
        isActive: true,
        isStablecoin: true,
        symbol: "IDRX",
        peggedCurrency: "IDR",
        decimals: 6,
        name: "IDRX",
      },
      priceConfig: { baseRate: "1" },
    });
    const out = await svc.getPointPrice({ tokenId: "tk_idrx", currency: "IDR" });
    expect(exchangeRateService.findLatest).not.toHaveBeenCalled();
    expect(out.token.symbol).toBe("IDRX");
    expect(out.minimumPoints).toBe(15_000);
  });

  it("rejects when no exchange rate is available for non-pegged token", async () => {
    const { svc } = buildHarness({
      token: {
        isActive: true,
        isStablecoin: true,
        symbol: "USDC",
        peggedCurrency: "USD",
      },
      priceConfig: { baseRate: "1" },
      exchangeRate: null,
    });
    await expect(
      svc.getPointPrice({ tokenId: "tk_usdc", currency: "IDR" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("PointsService.getBalance", () => {
  it("returns '0' when no balance row exists", async () => {
    const { svc } = buildHarness({ balance: null });
    const out = await svc.getBalance("u1");
    expect(out).toEqual({ userId: "u1", balance: "0" });
  });

  it("returns the balance as a string", async () => {
    const { svc } = buildHarness({ balance: { balance: BigInt(123_456) } });
    const out = await svc.getBalance("u1");
    expect(out.balance).toBe("123456");
  });
});

describe("PointsService.createDeposit input validation", () => {
  const dto = {
    refId: "ref_1",
    walletAddress: "0xUSER",
    txHash: "0xhash",
    tokenId: "tk_1",
    blockchainId: "bc_1",
    contractAddress: "0xCONTRACT",
    tokenAmount: "100",
    currency: "IDR",
  };

  it("404s when user missing", async () => {
    const { svc } = buildHarness({ user: null });
    await expect(svc.createDeposit("u1", dto as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects when wallet doesn't match user's wallet", async () => {
    const { svc } = buildHarness({
      user: { id: "u1", walletAddress: "0xOTHER" },
    });
    await expect(svc.createDeposit("u1", dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("returns existing-deposit response when refId is reused (P2002)", async () => {
    const { svc } = buildHarness({
      user: { id: "u1", walletAddress: "0xUSER" },
      refIdCreateError: { code: "P2002" },
      existingPointTx: { id: "ptx_old", status: "PENDING" },
    });
    const out = await svc.createDeposit("u1", dto as never);
    expect(out.message).toMatch(/already submitted/i);
  });

  it("rejects when txHash already used by a non-failed deposit (409)", async () => {
    const { svc } = buildHarness({
      user: { id: "u1", walletAddress: "0xUSER" },
      existingByHash: { status: "PENDING" },
    });
    await expect(svc.createDeposit("u1", dto as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("rejects bad token (not active / not stablecoin)", async () => {
    const { svc } = buildHarness({
      user: { id: "u1", walletAddress: "0xUSER" },
      token: { isActive: false, isStablecoin: true, symbol: "USDC" },
    });
    await expect(svc.createDeposit("u1", dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects bad blockchain", async () => {
    const { svc } = buildHarness({
      user: { id: "u1", walletAddress: "0xUSER" },
      token: {
        isActive: true,
        isStablecoin: true,
        symbol: "USDC",
        peggedCurrency: "USD",
      },
      blockchain: { isActive: false },
    });
    await expect(svc.createDeposit("u1", dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects when smart contract not found / not active", async () => {
    const { svc } = buildHarness({
      user: { id: "u1", walletAddress: "0xUSER" },
      token: {
        isActive: true,
        isStablecoin: true,
        symbol: "USDC",
        peggedCurrency: "USD",
      },
      blockchain: { isActive: true },
      contract: null,
    });
    await expect(svc.createDeposit("u1", dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("PointsService.createDeposit happy path", () => {
  const dto = {
    refId: "ref_h",
    walletAddress: "0xUSER",
    txHash: "0xhash_h",
    tokenId: "tk_1",
    blockchainId: "bc_1",
    contractAddress: "0xCONTRACT",
    tokenAmount: "100",
    currency: "IDR",
  };

  it("creates a PENDING PointTransaction and enqueues verify-deposit", async () => {
    const { svc, prisma, queue } = buildHarness({
      user: { id: "u1", walletAddress: "0xUSER" },
      token: {
        isActive: true,
        isStablecoin: true,
        symbol: "IDRX",
        peggedCurrency: "IDR",
      },
      blockchain: { isActive: true },
      contract: { id: "sc_1", isActive: true },
      priceConfig: { baseRate: "1" },
    });
    const out = await svc.createDeposit("u1", dto as never);
    expect(prisma.pointTransaction.create).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      "verify-deposit",
      expect.objectContaining({ pointTransactionId: "ptx_top" }),
      expect.objectContaining({ attempts: 5 }),
    );
    expect(out.status).toBe("PENDING");
  });

  it("accepts a deposit whose payer is a linked (non-primary) address and records it", async () => {
    // Mirrors the Stellar case: the user's primary address is EVM, but the
    // on-chain payer is their linked G-address. Ownership is satisfied via
    // WalletAccountLink, and the payer is persisted for the verifier.
    const stellarDto = {
      ...dto,
      refId: "ref_link",
      txHash: "0xhash_link",
      walletAddress: "GSTELLARPAYER",
    };
    const { svc, prisma } = buildHarness({
      user: { id: "u1", walletAddress: "0xUSER" },
      walletLinks: [{ walletAddress: "GSTELLARPAYER" }],
      token: {
        isActive: true,
        isStablecoin: true,
        symbol: "IDRX",
        peggedCurrency: "IDR",
      },
      blockchain: { isActive: true },
      contract: { id: "sc_1", isActive: true },
      priceConfig: { baseRate: "1" },
    });
    const out = await svc.createDeposit("u1", stellarDto as never);
    expect(out.status).toBe("PENDING");
    expect(prisma.pointTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ walletAddress: "GSTELLARPAYER" }),
      }),
    );
  });
});

describe("PointsService.deductPoints", () => {
  it("rejects with 400 when balance is insufficient", async () => {
    const { svc } = buildHarness({
      balance: { balance: BigInt(100) },
    });
    await expect(
      svc.deductPoints({
        userId: "u1",
        amount: BigInt(500),
        referenceType: "PURCHASE",
        referenceId: "pur_x",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("decrements balance, writes a SPEND tx and invalidates cache", async () => {
    const { svc, txCalls, pointsCache } = buildHarness({
      balance: { balance: BigInt(1000) },
    });
    await svc.deductPoints({
      userId: "u1",
      amount: BigInt(300),
      referenceType: "PURCHASE",
      referenceId: "pur_x",
    });
    expect(txCalls.pointBalance.update).toHaveBeenCalled();
    expect(txCalls.pointTransaction.create).toHaveBeenCalled();
    expect(pointsCache.invalidateBalance).toHaveBeenCalledWith("u1");
  });

  it("creates a balance row when none exists yet", async () => {
    const { svc, txCalls } = buildHarness({ balance: null });
    await expect(
      svc.deductPoints({
        userId: "u1",
        amount: BigInt(0),
        referenceType: "X",
        referenceId: "y",
      }),
    ).resolves.toBeUndefined();
    // 0 amount → balance condition (0 < 0) false → succeeds; ensure path used.
    expect(txCalls.pointBalance.findUnique).toHaveBeenCalled();
  });
});

describe("PointsService.getDepositStatus", () => {
  it("404s when deposit not owned by user / not found", async () => {
    const { svc } = buildHarness();
    await expect(
      svc.getDepositStatus("u1", "ptx_missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("PointsService.updatePriceConfig", () => {
  it("deactivates old configs, inserts the new active one and invalidates cache", async () => {
    const { svc, prisma, pointsCache } = buildHarness();
    await svc.updatePriceConfig("IDR", "1", "admin_1");
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(pointsCache.invalidateConfig).toHaveBeenCalledWith("IDR");
    expect(pointsCache.invalidatePrices).toHaveBeenCalled();
  });
});
