import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { TokenCacheService } from "../valkey/services/token-cache.service";
import { TokensService } from "./tokens.service";

function buildHarness(opts: {
  blockchain?: Record<string, unknown> | null;
  token?: Record<string, unknown> | null;
  duplicate?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    blockchain: { findUnique: jest.fn(async () => opts.blockchain ?? null) },
    token: {
      findUnique: jest.fn(async () => opts.token ?? null),
      findFirst: jest.fn(async () => opts.duplicate ?? null),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "tk_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "tk_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "tk_x" })),
    },
  } as unknown as PrismaService;
  const cache = {
    invalidateToken: jest.fn(async () => undefined),
    getAllTokens: jest.fn(
      async (_k: string, fallback: () => unknown) => fallback(),
    ),
    getById: jest.fn(async (_id: string, fallback: () => unknown) => fallback()),
  } as unknown as TokenCacheService;
  return { svc: new TokensService(prisma, cache), prisma, cache };
}

describe("TokensService.create", () => {
  it("404s when blockchain missing", async () => {
    const { svc } = buildHarness({ blockchain: null });
    await expect(
      svc.create({ blockchainId: "bc_x", symbol: "USDC" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects duplicate (blockchainId, contractAddress)", async () => {
    const { svc } = buildHarness({
      blockchain: { id: "bc_x" },
      token: { id: "tk_dup" },
    });
    await expect(
      svc.create({
        blockchainId: "bc_x",
        contractAddress: "0xUSDC",
        symbol: "USDC",
      } as never),
    ).rejects.toThrow(/already exists/);
  });

  it("creates and invalidates token cache", async () => {
    const { svc, cache } = buildHarness({ blockchain: { id: "bc_x" } });
    await svc.create({
      blockchainId: "bc_x",
      contractAddress: "0xNEW",
      symbol: "USDC",
    } as never);
    expect(cache.invalidateToken).toHaveBeenCalled();
  });
});

describe("TokensService.findOne / update / remove", () => {
  it("findOne 404s when not found", async () => {
    const { svc } = buildHarness({ token: null });
    await expect(svc.findOne("tk_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update 404s when blockchainId override is invalid", async () => {
    const { svc } = buildHarness({
      token: { id: "tk_x", blockchainId: "bc_orig" },
      blockchain: null,
    });
    await expect(
      svc.update("tk_x", { blockchainId: "bc_missing" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update rejects duplicate contractAddress on the target chain", async () => {
    const { svc, prisma } = buildHarness({
      token: { id: "tk_x", blockchainId: "bc_orig" },
      blockchain: { id: "bc_orig" },
    });
    (prisma.token.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "tk_other",
    });
    await expect(
      svc.update("tk_x", { contractAddress: "0xDUP" } as never),
    ).rejects.toThrow(/already exists/);
  });

  it("update happy path invalidates cache for the specific token", async () => {
    const { svc, cache } = buildHarness({
      token: { id: "tk_x", blockchainId: "bc_orig" },
    });
    await svc.update("tk_x", { name: "USDC" } as never);
    expect(cache.invalidateToken).toHaveBeenCalledWith("tk_x");
  });

  it("remove invalidates cache after delete", async () => {
    const { svc, cache } = buildHarness({ token: { id: "tk_x" } });
    await svc.remove("tk_x");
    expect(cache.invalidateToken).toHaveBeenCalledWith("tk_x");
  });
});

describe("TokensService.search filter assembly", () => {
  it("composes symbol/name/blockchainId/contractAddress and boolean filters", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search(
      {
        symbol: "USD",
        name: "Coin",
        blockchainId: "bc_x",
        contractAddress: "0xabc",
        isStablecoin: true,
        isActive: true,
        isNativeCurrency: false,
        isPaymentEnabled: true,
      } as never,
      {},
    );
    const findMany = (prisma.token.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where).toMatchObject({
      symbol: { contains: "USD", mode: "insensitive" },
      name: { contains: "Coin", mode: "insensitive" },
      blockchainId: "bc_x",
      contractAddress: { contains: "0xabc", mode: "insensitive" },
      isStablecoin: true,
      isActive: true,
      isNativeCurrency: false,
      isPaymentEnabled: true,
    });
  });
});
