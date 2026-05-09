import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { PrismaService } from "../prisma/prisma.service";
import type { BlockchainVerificationService } from "../blockchain-verification/blockchain-verification.service";
import { NftService } from "./nft.service";

// Mock viem's readContract so we don't hit the network.
jest.mock("viem/actions", () => ({
  readContract: jest.fn(),
}));

const { readContract } = require("viem/actions");

function buildHarness(opts: {
  blockchain?: Record<string, unknown> | null;
  asset?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    blockchain: { findUnique: jest.fn(async () => opts.blockchain ?? null) },
    nftAsset: {
      findFirst: jest.fn(async () => opts.asset ?? null),
      findMany: jest.fn(async () => []),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: "nft_new",
        ...create,
      })),
      delete: jest.fn(async () => ({ id: "nft_x" })),
    },
  } as unknown as PrismaService;

  const blockchainVerification = {
    getPublicClient: jest.fn(() => ({})),
  } as unknown as BlockchainVerificationService;

  const queue = {
    add: jest.fn(async () => ({ id: "q_1" })),
  } as unknown as Queue;

  const svc = new NftService(prisma, blockchainVerification, queue);
  return { svc, prisma, queue };
}

describe("NftService.addNftAsset prerequisite checks", () => {
  it("rejects unknown blockchain (400)", async () => {
    const { svc } = buildHarness({ blockchain: null });
    await expect(
      svc.addNftAsset("u1", "0xUSER", {
        contractAddress: "0xCONTRACT",
        tokenId: "1",
        blockchainId: "bc_x",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects non-EVM chain (NFT path is EVM-only)", async () => {
    const { svc } = buildHarness({
      blockchain: { id: "bc_x", isEVM: false, chainId: null, name: "Solana" },
    });
    await expect(
      svc.addNftAsset("u1", "0xUSER", {
        contractAddress: "0xCONTRACT",
        tokenId: "1",
        blockchainId: "bc_x",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("NftService.addNftAsset ownership verification", () => {
  beforeEach(() => {
    (readContract as jest.Mock).mockReset();
  });

  it("rejects when ERC-721 ownerOf returns a different wallet", async () => {
    (readContract as jest.Mock)
      .mockResolvedValueOnce(false) // supportsInterface ERC-1155 → no
      .mockResolvedValueOnce("0xother") // ownerOf
      .mockResolvedValueOnce("ipfs://meta") // tokenURI (not reached)
      .mockResolvedValueOnce("Test"); // name fallback
    const { svc } = buildHarness({
      blockchain: { id: "bc_x", isEVM: true, chainId: 1, name: "ETH" },
    });
    await expect(
      svc.addNftAsset("u1", "0xUSER000000000000000000000000000000000000", {
        contractAddress: "0xCONTRACT",
        tokenId: "1",
        blockchainId: "bc_x",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when ERC-1155 balance is 0", async () => {
    (readContract as jest.Mock)
      .mockResolvedValueOnce(true) // supportsInterface ERC-1155 → yes
      .mockResolvedValueOnce(0n); // balanceOf
    const { svc } = buildHarness({
      blockchain: { id: "bc_x", isEVM: true, chainId: 1, name: "ETH" },
    });
    await expect(
      svc.addNftAsset("u1", "0xUSER", {
        contractAddress: "0xCONTRACT",
        tokenId: "1",
        blockchainId: "bc_x",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when ERC-721 ownerOf throws (token doesn't exist)", async () => {
    (readContract as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("revert"));
    const { svc } = buildHarness({
      blockchain: { id: "bc_x", isEVM: true, chainId: 1, name: "ETH" },
    });
    await expect(
      svc.addNftAsset("u1", "0xUSER", {
        contractAddress: "0xCONTRACT",
        tokenId: "1",
        blockchainId: "bc_x",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("NftService.removeNftAsset / refreshNftAsset", () => {
  it("removeNftAsset 404s when asset missing/not owned", async () => {
    const { svc } = buildHarness({ asset: null });
    await expect(svc.removeNftAsset("u1", "nft_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("removeNftAsset deletes when found", async () => {
    const { svc, prisma } = buildHarness({
      asset: { id: "nft_1", userId: "u1" },
    });
    await svc.removeNftAsset("u1", "nft_1");
    expect(prisma.nftAsset.delete).toHaveBeenCalledWith({ where: { id: "nft_1" } });
  });

  it("refreshNftAsset 404s when asset missing", async () => {
    const { svc } = buildHarness({ asset: null });
    await expect(svc.refreshNftAsset("u1", "nft_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("NftService.getUserNftAssets", () => {
  it("queries by userId+isOwned and enqueues a re-verify job (fire-and-forget)", async () => {
    const { svc, prisma, queue } = buildHarness();
    await svc.getUserNftAssets("u1");
    expect(prisma.nftAsset.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", isOwned: true },
      orderBy: { createdAt: "desc" },
    });
    expect(queue.add).toHaveBeenCalledWith(
      "verify-nft-ownership",
      { userId: "u1" },
      { delay: 0 },
    );
  });

  it("does NOT throw when queue.add rejects (fire-and-forget swallows)", async () => {
    const { svc, queue } = buildHarness();
    (queue.add as jest.Mock).mockRejectedValueOnce(new Error("queue down"));
    await expect(svc.getUserNftAssets("u1")).resolves.toBeDefined();
  });
});
