import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { SmartContractCacheService } from "../valkey/services/smart-contract-cache.service";
import { SmartContractsService } from "./smart-contracts.service";

function buildHarness(opts: {
  contract?: Record<string, unknown> | null;
  contracts?: Record<string, unknown>[];
  contractByChain?: Record<string, unknown> | null;
} = {}) {
  const contracts = opts.contracts ?? [];
  const prisma = {
    smartContract: {
      findUnique: jest.fn(async () => opts.contract ?? null),
      findFirst: jest.fn(async () => opts.contractByChain ?? null),
      findMany: jest.fn(async () => contracts),
      count: jest.fn(async () => contracts.length),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "sc_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "sc_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "sc_x" })),
    },
  } as unknown as PrismaService;

  const cache = {
    getAllContracts: jest.fn(
      async (_k: string, fallback: () => unknown) => fallback(),
    ),
    getById: jest.fn(async (_id: string, fallback: () => unknown) => fallback()),
    getByChainId: jest.fn(
      async (_id: number, fallback: () => unknown) => fallback(),
    ),
    getByBlockchainAndAddress: jest.fn(
      async (_a: string, _b: string, fallback: () => unknown) => fallback(),
    ),
    invalidateContract: jest.fn(async () => undefined),
  } as unknown as SmartContractCacheService;
  return { svc: new SmartContractsService(prisma, cache), prisma, cache };
}

describe("SmartContractsService", () => {
  it("findOne 404s when missing", async () => {
    const { svc } = buildHarness({ contract: null });
    await expect(svc.findOne("sc_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("findByChainId 404s when no active contract on that chain", async () => {
    const { svc } = buildHarness({ contractByChain: null });
    await expect(svc.findByChainId(137)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update P2025 → 404", async () => {
    const { svc, prisma } = buildHarness();
    const { Prisma } = await import("@generated/prisma");
    (prisma.smartContract.update as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("not found", {
        code: "P2025",
        clientVersion: "0",
      }),
    );
    await expect(svc.update("sc_x", { name: "X" } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("update happy path invalidates cache", async () => {
    const { svc, cache } = buildHarness();
    await svc.update("sc_x", { name: "X" } as never);
    expect(cache.invalidateContract).toHaveBeenCalledWith("sc_x");
  });

  it("remove P2025 → 404", async () => {
    const { svc, prisma } = buildHarness();
    const { Prisma } = await import("@generated/prisma");
    (prisma.smartContract.delete as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("not found", {
        code: "P2025",
        clientVersion: "0",
      }),
    );
    await expect(svc.remove("sc_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("search composes name/blockchainId, address, isActive and nested blockchain filters", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search(
      {
        name: "Takumi",
        blockchainId: "bc_x",
        blockchainName: "Polygon",
        chainId: 137,
        isBlockchainEVM: true,
        address: "0xAA",
        isActive: true,
      } as never,
      {},
    );
    const findMany = (prisma.smartContract.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.name).toEqual({ contains: "Takumi", mode: "insensitive" });
    expect(findMany.where.blockchainId).toBe("bc_x");
    expect(findMany.where.blockchain.name.contains).toBe("Polygon");
    expect(findMany.where.blockchain.chainId).toBe(137);
    expect(findMany.where.blockchain.isEVM).toBe(true);
    expect(findMany.where.address).toBe("0xAA");
    expect(findMany.where.isActive).toBe(true);
  });
});
