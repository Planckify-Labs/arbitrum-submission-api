import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * Query DTO for `GET /admin/qris-claims` (§6.6 `merchant_qris_claims`,
 * §12 Q9 dispute workflow). Admins hit this endpoint with *exactly one*
 * of `qrisPan` or `merchantId` set — the service enforces mutual
 * exclusivity so the filter semantics are unambiguous.
 *
 * Filter-at-source (memory `feedback_filter_at_source.md`): the query
 * arg is passed straight into the Prisma `where` clause. No post-filter
 * remap in the controller.
 */
export class ListClaimsQueryDto {
  /**
   * QRIS PAN (spec §6.6 — Primary Account Number). Max 19 digits per
   * EMV QR spec (GR-59-01 § Q). Ops pastes the PAN from the dispute
   * email / WhatsApp ticket; we let it through as a string rather than
   * a number because leading zeros matter.
   */
  @ApiPropertyOptional({
    description: "QRIS PAN (19-digit EMV identifier) to look up claims for.",
    example: "936000091234567890",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,19}$/, {
    message: "qrisPan must be 6–19 digits (EMV QR GR-59-01 § Q).",
  })
  qrisPan?: string;

  /**
   * Merchant ULID — 26 char Crockford base32, matches the `Merchant.id`
   * shape produced by `generateUlid()` in `merchants.service.ts`.
   */
  @ApiPropertyOptional({
    description: "Merchant id (ULID) to list all claims for.",
    example: "01HTEST0000000000000000000",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  merchantId?: string;
}
