import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { ReferenceIdService } from "./reference-id.service";

function buildHarness(opts: {
  existing?: Record<string, unknown> | null;
  deleteCount?: number;
} = {}) {
  const prisma = {
    referenceId: {
      findUnique: jest.fn(async () => opts.existing ?? null),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
      })),
      deleteMany: jest.fn(async () => ({ count: opts.deleteCount ?? 0 })),
    },
  } as unknown as PrismaService;
  return { svc: new ReferenceIdService(prisma), prisma };
}

describe("ReferenceIdService.validateUniqueRefId", () => {
  it("rejects empty / whitespace refId", async () => {
    const { svc } = buildHarness();
    await expect(svc.validateUniqueRefId("   ")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects when refId already exists (409)", async () => {
    const { svc } = buildHarness({ existing: { refId: "x", status: "PROCESSING" } });
    await expect(svc.validateUniqueRefId("x")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("resolves when refId is fresh", async () => {
    const { svc } = buildHarness({ existing: null });
    await expect(svc.validateUniqueRefId("fresh")).resolves.toBeUndefined();
  });
});

describe("ReferenceIdService.updateReferenceIdStatus metadata merge", () => {
  it("merges metadata when an existing row already has metadata", async () => {
    const { svc, prisma } = buildHarness({
      existing: { metadata: { walletAddress: "0xA", purchaseId: "p_old" } },
    });
    await svc.markAsCompleted("ref_x", { purchaseId: "p_new", bookingId: "b_x" });
    const upsert = (prisma.referenceId.upsert as jest.Mock).mock.calls[0][0];
    expect(upsert.update.metadata).toEqual({
      walletAddress: "0xA",
      purchaseId: "p_new",
      bookingId: "b_x",
    });
  });

  it("uses bare metadata when no existing row is found", async () => {
    const { svc, prisma } = buildHarness({ existing: null });
    await svc.markAsProcessing("ref_x", { walletAddress: "0xA" });
    const upsert = (prisma.referenceId.upsert as jest.Mock).mock.calls[0][0];
    expect(upsert.update.metadata).toEqual({ walletAddress: "0xA" });
  });

  it("does not include metadata field when none was given", async () => {
    const { svc, prisma } = buildHarness({ existing: null });
    await svc.markAsFailed("ref_x");
    const upsert = (prisma.referenceId.upsert as jest.Mock).mock.calls[0][0];
    expect(upsert.update.metadata).toBeUndefined();
  });
});

describe("ReferenceIdService.cleanupOldReferenceIds", () => {
  it("only deletes COMPLETED/FAILED rows older than the cutoff", async () => {
    const { svc, prisma } = buildHarness({ deleteCount: 5 });
    const out = await svc.cleanupOldReferenceIds(7);
    const args = (prisma.referenceId.deleteMany as jest.Mock).mock.calls[0][0];
    expect(args.where.status.in).toEqual(["COMPLETED", "FAILED"]);
    expect(args.where.createdAt.lt).toBeInstanceOf(Date);
    expect(out).toBe(5);
  });
});
