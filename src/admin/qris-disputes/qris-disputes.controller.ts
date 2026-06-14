import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@generated/prisma";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { Roles } from "../../decorators/roles.decorator";
import { QrisClaimResponseDto } from "./dto/claim-response.dto";
import { ListClaimsQueryDto } from "./dto/list-claims.dto";
import { ReviewClaimDto } from "./dto/review-claim.dto";
import { QrisDisputesService } from "./qris-disputes.service";

/**
 * Ops-only surface for the QRIS PAN dispute workflow (spec §6.6,
 * §12 Q9).
 *
 * Every route is:
 *   1. Gated on a valid admin JWT via `JwtAuthGuard` (extracts user id),
 *   2. Scoped to `UserRole.ADMIN` / `UserRole.SUPER_ADMIN` via the
 *      globally-registered `RolesGuard` (see `auth.module.ts`).
 *
 * Non-admins are rejected with 403 before the service is entered. No
 * self-service path exists for merchants — disputes arrive via WhatsApp
 * / email (§12 Q9) and ops acts server-side (three-role separation,
 * memory `feedback_role_separation.md`).
 *
 * URL prefix: `admin/qris-claims`. The spec writes this as
 * `/v1/admin/qris-claims`; the takumipay-api repo has no global `v1/`
 * prefix (see `src/main.ts`), so the URL lands at
 * `/admin/qris-claims` under the single versioned host.
 */
@Controller("admin/qris-claims")
@ApiTags("admin-qris-disputes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class QrisDisputesController {
  constructor(private readonly disputes: QrisDisputesService) {}

  /**
   * Look up claim rows — by PAN (expected cardinality ≈ 1 per the
   * first-claim-wins unique index; can be > 1 if ops has manually
   * cleared a PAN in a prior dispute) or by merchantId (all claims
   * that merchant has ever submitted).
   *
   * DTO validates that at least one filter is present and that PANs
   * are well-formed; the service rejects the ambiguous "both set" case.
   */
  @Get()
  @ApiOperation({
    summary:
      "List QRIS claim rows for a PAN or merchant (admin only, §6.6).",
  })
  @ApiResponse({
    status: 200,
    type: QrisClaimResponseDto,
    isArray: true,
  })
  @ApiResponse({ status: 400, description: "Missing or conflicting filter." })
  @ApiResponse({ status: 403, description: "Not an admin." })
  list(
    @Query() query: ListClaimsQueryDto,
  ): Promise<QrisClaimResponseDto[]> {
    return this.disputes.listClaims({
      qrisPan: query.qrisPan,
      merchantId: query.merchantId,
    });
  }

  /**
   * Record an ops review decision on a single claim.
   *
   * - `confirm` → `disputeStatus = resolved_valid`; `Merchant.qrisPan`
   *   untouched.
   * - `revoke`  → `disputeStatus = resolved_invalid`;
   *   `Merchant.qrisPan` cleared in the same transaction so the
   *   partial-unique index frees up and the real merchant can retry
   *   signup.
   *
   * Always writes an `AdminAuditLog` row with the admin user id,
   * decision, note, and before/after values (see service).
   */
  @Post(":id/review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Record an ops review decision (confirm | revoke) on a claim. Revoke frees the PAN atomically.",
  })
  @ApiResponse({ status: 200, type: QrisClaimResponseDto })
  @ApiResponse({ status: 400, description: "Already-resolved or invalid DTO." })
  @ApiResponse({ status: 403, description: "Not an admin." })
  @ApiResponse({ status: 404, description: "Claim id not found." })
  review(
    @Param("id") claimId: string,
    @Body() body: ReviewClaimDto,
    @Request() req: AdminRequest,
  ): Promise<QrisClaimResponseDto> {
    const adminUserId = this.requireAdminUserId(req);
    const ipAddress = extractIp(req);
    const userAgent =
      typeof req.headers?.["user-agent"] === "string"
        ? (req.headers["user-agent"] as string)
        : undefined;

    return this.disputes.reviewClaim(claimId, body, adminUserId, {
      ipAddress,
      userAgent,
    });
  }

  /**
   * Guard rails — JwtAuthGuard + RolesGuard already enforce admin
   * identity; this is the defensive "undefined.id" check mirrored from
   * `merchants.controller.ts`.
   */
  private requireAdminUserId(req: AdminRequest): string {
    const id = req.user?.id;
    if (!id) {
      throw new UnauthorizedException({
        message: "Authenticated admin id missing from request.",
        code: "AUTH_ADMIN_MISSING",
      });
    }
    return id;
  }
}

/**
 * Narrow request shape for the handler — matches the JWT strategy's
 * `validate()` return (`id`, `role`, etc). We only need `id` here;
 * RolesGuard handles the role check upstream.
 */
interface AdminRequest {
  user?: { id: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

function extractIp(req: AdminRequest): string | undefined {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    // x-forwarded-for is a comma-separated list; the client IP is the first.
    return xff.split(",")[0]?.trim() || undefined;
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0];
  }
  return req.ip ?? req.socket?.remoteAddress ?? undefined;
}
