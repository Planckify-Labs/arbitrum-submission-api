import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { QrisClaimResponseDto } from "./dto/claim-response.dto";
import type {
  ReviewClaimDto,
  ReviewDecision,
} from "./dto/review-claim.dto";

/**
 * QRIS PAN dispute workflow (spec §6.6 `merchant_qris_claims`, §12 Q9).
 *
 * First-claim-wins is enforced at sign-up (task 27). This service owns
 * the ops-side *undo*: when the losing merchant surfaces via the
 * external support channel, an admin reviews the sticker photo and
 * either **confirms** the existing claim (no mutation) or **revokes**
 * it, freeing the partial-unique `Merchant.qrisPan` index so the real
 * merchant can retry signup.
 *
 * ### Invariants
 *
 * - **Atomic revoke** — the claim status flip and `Merchant.qrisPan`
 *   clear must commit together. Any mid-transaction failure rolls both
 *   back so a PAN can't be silently freed without an audit row, or
 *   marked resolved while the merchant still has it.
 * - **Append-only audit** — the claim row itself is never deleted. The
 *   dispute-status transitions leave a breadcrumb; pair with the
 *   `AdminAuditLog` hypertable for the reviewer identity + note.
 * - **Three-role separation (memory `feedback_role_separation.md`)** —
 *   this path is ops-only. Merchants cannot hit it; the RolesGuard
 *   (registered APP_GUARD in `auth.module.ts`) rejects non-admins with
 *   403 before control reaches the service.
 */
@Injectable()
export class QrisDisputesService {
  private readonly logger = new Logger(QrisDisputesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up claims by PAN *or* by merchantId. The caller DTO enforces
   * that at least one filter is present; the service rejects the
   * ambiguous "both set" case with 400 so the semantics stay unambiguous.
   *
   * Filter-at-source: the provided field is passed straight into Prisma
   * (`where.qrisPan` or `where.merchantId`). No post-filter in the
   * controller.
   */
  async listClaims(filter: {
    qrisPan?: string;
    merchantId?: string;
  }): Promise<QrisClaimResponseDto[]> {
    const { qrisPan, merchantId } = filter;
    if (!qrisPan && !merchantId) {
      throw new BadRequestException({
        message:
          "Provide one of `qrisPan` or `merchantId` to scope the lookup.",
        code: "QRIS_CLAIMS_FILTER_REQUIRED",
      });
    }
    if (qrisPan && merchantId) {
      throw new BadRequestException({
        message:
          "Pass exactly one of `qrisPan` or `merchantId` — combining them is ambiguous.",
        code: "QRIS_CLAIMS_FILTER_CONFLICT",
      });
    }

    const rows = await this.prisma.merchantQrisClaim.findMany({
      where: qrisPan ? { qrisPan } : { merchantId: merchantId as string },
      orderBy: { claimedAt: "asc" },
    });

    return rows.map((r) => this.toResponseDto(r));
  }

  /**
   * Ops review: confirm or revoke a claim. Revoke is a *single DB
   * transaction* covering (a) flipping `disputeStatus` to
   * `resolved_invalid`, (b) stamping `reviewedAt`, and (c) clearing the
   * owning `Merchant.qrisPan` so the partial-unique index frees up.
   *
   * Audit log (`AdminAuditLog`, §6.6 audit hypertable) is written in
   * the same transaction: the reviewer identity, decision, and note land
   * atomically with the DB mutation. If the audit insert ever fails, the
   * review is rolled back — we don't want silent state changes.
   */
  async reviewClaim(
    claimId: string,
    dto: ReviewClaimDto,
    adminUserId: string,
    reqMeta: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<QrisClaimResponseDto> {
    const existing = await this.prisma.merchantQrisClaim.findFirst({
      where: { id: claimId },
    });
    if (!existing) {
      throw new NotFoundException({
        message: `No QRIS claim found with id '${claimId}'.`,
        code: "QRIS_CLAIM_NOT_FOUND",
      });
    }

    // Guard against double-review — once a claim is resolved either
    // way, re-review needs a fresh ticket (ops can still open a new
    // dispute by re-signing up after a revoke). This keeps the audit
    // trail monotonic: status only transitions open→resolved_* once.
    if (
      existing.disputeStatus === "resolved_valid" ||
      existing.disputeStatus === "resolved_invalid"
    ) {
      throw new BadRequestException({
        message: `Claim '${claimId}' is already resolved (${existing.disputeStatus}). Open a fresh dispute to revisit.`,
        code: "QRIS_CLAIM_ALREADY_RESOLVED",
      });
    }

    const nextStatus: "resolved_valid" | "resolved_invalid" =
      dto.decision === "confirm" ? "resolved_valid" : "resolved_invalid";
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.merchantQrisClaim.update({
        where: { id: existing.id },
        data: {
          disputeStatus: nextStatus,
          reviewedAt: now,
        },
      });

      // Revoke path: clear the Merchant's qrisPan so the partial-unique
      // index frees up. The complainant can then retry signup and the
      // DB-level uniqueness will accept the new claim.
      if (dto.decision === "revoke") {
        await tx.merchant.update({
          where: { id: existing.merchantId },
          data: { qrisPan: null },
        });
      }

      // Audit log — written in the same tx so the reviewer identity +
      // decision + note commit atomically with the state change.
      // `AdminAuditLog` is the existing hypertable (§6.6) — no new
      // audit infra required.
      await tx.adminAuditLog.create({
        data: {
          adminUser: { connect: { id: adminUserId } },
          action: `QRIS_CLAIM_${dto.decision.toUpperCase()}`,
          resource: "MerchantQrisClaim",
          resourceId: existing.id,
          oldValues: {
            disputeStatus: existing.disputeStatus,
            reviewedAt: existing.reviewedAt?.toISOString() ?? null,
            merchantQrisPan: existing.qrisPan,
          },
          newValues: {
            disputeStatus: nextStatus,
            reviewedAt: now.toISOString(),
            merchantQrisPan:
              dto.decision === "revoke" ? null : existing.qrisPan,
          },
          metadata: {
            decision: dto.decision,
            note: dto.note,
            merchantId: existing.merchantId,
            qrisPan: existing.qrisPan,
          },
          ipAddress: reqMeta.ipAddress ?? null,
          userAgent: reqMeta.userAgent ?? null,
        },
      });

      return row;
    });

    this.logger.log(
      `QRIS claim ${existing.id} reviewed (${dto.decision}) by admin ${adminUserId}`,
    );

    return this.toResponseDto(updated);
  }

  /**
   * Projection. Dates go out as unix-ms (same convention as
   * `merchants.service.ts#toResponseDto`) so the ops UI doesn't
   * have to parse Prisma's ISO strings.
   *
   * Evidence-photo signed URL is a TODO — see
   * `dto/claim-response.dto.ts`. We return the raw stickerPhotoKey plus
   * `evidencePhotoUrl: null` so callers can already code against the
   * final shape.
   */
  private toResponseDto(row: {
    id: string;
    merchantId: string;
    qrisPan: string;
    stickerPhotoKey: string;
    claimedAt: Date;
    reviewedAt: Date | null;
    disputeStatus: "none" | "open" | "resolved_valid" | "resolved_invalid";
    createdAt: Date;
    updatedAt: Date;
  }): QrisClaimResponseDto {
    return {
      id: row.id,
      merchantId: row.merchantId,
      qrisPan: row.qrisPan,
      stickerPhotoKey: row.stickerPhotoKey,
      evidencePhotoUrl: null,
      disputeStatus: row.disputeStatus,
      claimedAt: row.claimedAt.getTime(),
      reviewedAt: row.reviewedAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }
}

export type { ReviewDecision };
