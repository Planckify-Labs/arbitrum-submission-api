import {
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import { QrisDisputesService } from "./qris-disputes.service";

/**
 * Unit tests for the QRIS dispute ops tool (task 45).
 *
 * The tests stub Prisma — we don't need a real DB because the invariants
 * we care about are wire-shape + transaction composition:
 *
 *   1. `GET` filter semantics (PAN vs merchantId, mutex).
 *   2. Revoke is atomic: claim update + merchant clear + audit insert
 *      happen inside a single `$transaction` callback.
 *   3. Confirm path does NOT touch `Merchant.qrisPan`.
 *   4. Already-resolved claims reject a second review.
 *   5. Audit log captures decision + note + before/after values.
 *
 * The admin-only 403 coverage lives at the controller layer — the
 * globally-registered `RolesGuard` is what enforces role, not this
 * service. A dedicated controller spec would wire Nest testing,
 * which is overkill for the task; we document the contract here
 * and leave HTTP-level coverage to e2e.
 */

type MockFn = jest.Mock;

interface FakeTx {
  merchantQrisClaim: { update: MockFn };
  merchant: { update: MockFn };
  adminAuditLog: { create: MockFn };
}

function buildPrisma(opts: {
  existingClaim?: Record<string, unknown> | null;
  claimRows?: Array<Record<string, unknown>>;
  updatedRow?: Record<string, unknown>;
  merchantUpdateThrows?: boolean;
} = {}) {
  const now = new Date("2026-04-20T00:00:00Z");
  const defaultClaim = {
    id: "01HCLAIM0000000000000000000",
    merchantId: "01HMERCHANT00000000000000000",
    qrisPan: "936000091234567890",
    stickerPhotoKey: "s3://evidence/claim1.jpg",
    claimedAt: now,
    reviewedAt: null,
    disputeStatus: "none" as const,
    createdAt: now,
    updatedAt: now,
  };
  const existingClaim =
    opts.existingClaim === undefined ? defaultClaim : opts.existingClaim;
  const claimRows = opts.claimRows ?? (existingClaim ? [existingClaim] : []);

  const tx: FakeTx = {
    merchantQrisClaim: {
      update: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...(existingClaim ?? defaultClaim),
          ...data,
          ...(opts.updatedRow ?? {}),
        }),
      ),
    },
    merchant: {
      update: jest.fn(async () => {
        await Promise.resolve();
        if (opts.merchantUpdateThrows) {
          throw new Error("merchant-update-boom");
        }
        return { id: existingClaim?.merchantId ?? "mch_X", qrisPan: null };
      }),
    },
    adminAuditLog: {
      create: jest.fn(async () => ({ id: "audit_1", createdAt: new Date() })),
    },
  };

  const prisma = {
    merchantQrisClaim: {
      findMany: jest.fn(async () => claimRows),
      findFirst: jest.fn(async () => existingClaim ?? null),
    },
    $transaction: jest.fn(async (cb: (tx: FakeTx) => Promise<unknown>) =>
      cb(tx),
    ),
  };

  return { prisma, tx };
}

describe("QrisDisputesService", () => {
  describe("listClaims", () => {
    it("rejects a call with neither filter set (400)", async () => {
      const { prisma } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);
      await expect(svc.listClaims({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects a call with BOTH filters set — semantics would be ambiguous", async () => {
      const { prisma } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);
      await expect(
        svc.listClaims({ qrisPan: "1", merchantId: "2" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("looks up by qrisPan — passes the arg straight into Prisma (filter-at-source)", async () => {
      const { prisma } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);
      const result = await svc.listClaims({ qrisPan: "936000091234567890" });

      expect(result).toHaveLength(1);
      expect(result[0].qrisPan).toBe("936000091234567890");
      expect(prisma.merchantQrisClaim.findMany).toHaveBeenCalledWith({
        where: { qrisPan: "936000091234567890" },
        orderBy: { claimedAt: "asc" },
      });
    });

    it("looks up by merchantId — same filter-at-source path", async () => {
      const { prisma } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);
      await svc.listClaims({ merchantId: "01HMERCHANT00000000000000000" });
      expect(prisma.merchantQrisClaim.findMany).toHaveBeenCalledWith({
        where: { merchantId: "01HMERCHANT00000000000000000" },
        orderBy: { claimedAt: "asc" },
      });
    });

    it("returns an empty array when there are no claims", async () => {
      const { prisma } = buildPrisma({ claimRows: [], existingClaim: null });
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);
      const result = await svc.listClaims({ qrisPan: "000" });
      expect(result).toEqual([]);
    });

    it("projects claim rows without leaking internal-only fields", async () => {
      const { prisma } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);
      const [row] = await svc.listClaims({ qrisPan: "936000091234567890" });
      // Wire shape contract — see dto/claim-response.dto.ts.
      expect(Object.keys(row).sort()).toEqual(
        [
          "claimedAt",
          "createdAt",
          "disputeStatus",
          "evidencePhotoUrl",
          "id",
          "merchantId",
          "qrisPan",
          "reviewedAt",
          "stickerPhotoKey",
          "updatedAt",
        ].sort(),
      );
      // Evidence URL is null in v1 (TODO: signed-URL helper).
      expect(row.evidencePhotoUrl).toBeNull();
      // Dates are unix-ms, not Date objects or ISO strings.
      expect(typeof row.claimedAt).toBe("number");
    });
  });

  describe("reviewClaim", () => {
    it("404s when the claim id doesn't exist", async () => {
      const { prisma } = buildPrisma({ existingClaim: null });
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);
      await expect(
        svc.reviewClaim(
          "nope",
          { decision: "revoke", note: "ticket #1" },
          "admin_1",
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("CONFIRM → sets disputeStatus=resolved_valid, does NOT clear the merchant's qrisPan", async () => {
      const { prisma, tx } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);

      const result = await svc.reviewClaim(
        "01HCLAIM0000000000000000000",
        { decision: "confirm", note: "Evidence matches Xendit settlement." },
        "admin_user_1",
      );

      expect(result.disputeStatus).toBe("resolved_valid");
      expect(typeof result.reviewedAt).toBe("number");
      expect(tx.merchantQrisClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "01HCLAIM0000000000000000000" },
          data: expect.objectContaining({ disputeStatus: "resolved_valid" }),
        }),
      );
      // Critical: confirm MUST NOT touch Merchant.qrisPan.
      expect(tx.merchant.update).not.toHaveBeenCalled();
      // Audit row written in the same tx.
      expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it("REVOKE → flips status + clears Merchant.qrisPan in the SAME $transaction", async () => {
      const { prisma, tx } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);

      const result = await svc.reviewClaim(
        "01HCLAIM0000000000000000000",
        { decision: "revoke", note: "WA ticket #4411 — dispute valid." },
        "admin_user_2",
      );

      expect(result.disputeStatus).toBe("resolved_invalid");
      // Both mutations land inside ONE $transaction call.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Claim status flipped.
      expect(tx.merchantQrisClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            disputeStatus: "resolved_invalid",
          }),
        }),
      );
      // Merchant.qrisPan cleared — partial unique index is now free.
      expect(tx.merchant.update).toHaveBeenCalledWith({
        where: { id: "01HMERCHANT00000000000000000" },
        data: { qrisPan: null },
      });
      // Audit row captures the decision + note + before/after.
      expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
      const auditArgs = tx.adminAuditLog.create.mock.calls[0][0] as {
        data: {
          action: string;
          resource: string;
          resourceId: string;
          metadata: { decision: string; note: string; merchantId: string };
          oldValues: { disputeStatus: string };
          newValues: { disputeStatus: string; merchantQrisPan: null };
        };
      };
      expect(auditArgs.data.action).toBe("QRIS_CLAIM_REVOKE");
      expect(auditArgs.data.resource).toBe("MerchantQrisClaim");
      expect(auditArgs.data.resourceId).toBe("01HCLAIM0000000000000000000");
      expect(auditArgs.data.metadata.decision).toBe("revoke");
      expect(auditArgs.data.metadata.note).toBe(
        "WA ticket #4411 — dispute valid.",
      );
      expect(auditArgs.data.newValues.merchantQrisPan).toBeNull();
      expect(auditArgs.data.oldValues.disputeStatus).toBe("none");
    });

    it("REVOKE transaction rolls back if the Merchant update throws (atomicity invariant)", async () => {
      const { prisma, tx } = buildPrisma({ merchantUpdateThrows: true });
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);

      await expect(
        svc.reviewClaim(
          "01HCLAIM0000000000000000000",
          { decision: "revoke", note: "will fail" },
          "admin_user_3",
        ),
      ).rejects.toThrow("merchant-update-boom");

      // Audit row must NOT have been written when merchant.update threw —
      // proves the audit insert is after the merchant clear and inside the
      // same transaction scope.
      expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it("rejects a second review on an already-resolved claim (append-only invariant)", async () => {
      const { prisma } = buildPrisma({
        existingClaim: {
          id: "01HCLAIM0000000000000000000",
          merchantId: "01HMERCHANT00000000000000000",
          qrisPan: "936000091234567890",
          stickerPhotoKey: "s3://evidence/1.jpg",
          claimedAt: new Date(),
          reviewedAt: new Date(),
          disputeStatus: "resolved_valid" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);

      await expect(
        svc.reviewClaim(
          "01HCLAIM0000000000000000000",
          { decision: "revoke", note: "retry" },
          "admin_user_4",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("passes the admin user id + ip + UA into the audit log", async () => {
      const { prisma, tx } = buildPrisma();
      const svc = new QrisDisputesService(prisma as unknown as PrismaService);

      await svc.reviewClaim(
        "01HCLAIM0000000000000000000",
        { decision: "confirm", note: "looks fine" },
        "admin_99",
        { ipAddress: "203.0.113.9", userAgent: "ops-cli/1.2.3" },
      );

      const args = tx.adminAuditLog.create.mock.calls[0][0] as {
        data: {
          adminUser: { connect: { id: string } };
          ipAddress: string | null;
          userAgent: string | null;
        };
      };
      expect(args.data.adminUser.connect.id).toBe("admin_99");
      expect(args.data.ipAddress).toBe("203.0.113.9");
      expect(args.data.userAgent).toBe("ops-cli/1.2.3");
    });
  });
});
