import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

/**
 * Sub-object for the optional QRIS sticker linkage carried on the
 * scan-QRIS-first onboarding path (§1.1.1). The `qrisPan` is the PAN
 * extracted from EMVCo tag 26 sub-01; `stickerPhotoKey` references an
 * object-store key for the evidence photo captured at scan time.
 *
 * Claim semantics: first non-null `qrisPan` wins (partial unique index on
 * `Merchant.qrisPan` — see schema comment). A duplicate is a 409, not a
 * silent overwrite.
 */
export class QrisLinkDto {
  @ApiProperty({
    description: "PAN from EMVCo tag 26 sub-01 of the merchant's QRIS sticker.",
  })
  @IsString()
  @Length(8, 40)
  qrisPan!: string;

  @ApiPropertyOptional({
    description: "Object-store key for the sticker evidence photo (optional).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  stickerPhotoKey?: string;
}

/**
 * Body shape for `POST /v1/merchants/signup`.
 *
 * Three-role separation (memory `feedback_role_separation.md`): the server
 * chooses the JWS kid, iat, exp, and signs the payload with a key that
 * lives only on the API. The client submits what the merchant *typed or
 * scanned* (display name, payout coords, optional QRIS) — nothing that
 * could influence trust attestation of the sticker.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.1 MerchantSignupRequest, §6.6
 * Merchant schema.
 */
export class CreateMerchantDto {
  @ApiProperty({
    description: "Merchant display name (customer-facing).",
    example: "Warung Mbak Sari",
  })
  @IsString()
  @Length(1, 80)
  displayName!: string;

  @ApiProperty({
    description:
      "ISO 3166-1 alpha-2 country code. Today only ID has seeded channels; unknown country+channel combinations fail with CHANNEL_UNKNOWN at the channel lookup, so the country allowlist is data-driven (the `Channel` table) rather than enum-locked here.",
    example: "ID",
  })
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: "countryCode must be an ISO 3166-1 alpha-2 code (e.g. ID)" })
  countryCode!: string;

  @ApiProperty({
    description:
      "Canonical payout channel code — validated against the `Channel` table for the given country.",
    example: "GOPAY",
  })
  @IsString()
  @Length(1, 32)
  payoutChannel!: string;

  @ApiProperty({
    description:
      "Polymorphic account identifier — phone (+62…) for e-wallets, digits for banks. Format validated against the channel's `accountFormat` regex.",
  })
  @IsString()
  @Length(3, 64)
  payoutAccountNumber!: string;

  @ApiProperty({
    description:
      "Legal account holder name. Must match the e-wallet/bank record exactly — Xendit rejects mismatches.",
  })
  @IsString()
  @Length(1, 120)
  payoutAccountHolderName!: string;

  @ApiPropertyOptional({
    description: "WhatsApp / contact phone (not the payout account).",
  })
  @IsOptional()
  @IsString()
  @Length(5, 32)
  contactPhone?: string;

  @ApiPropertyOptional({
    description: "Optional QRIS sticker linkage (scan-QRIS-first path).",
    type: QrisLinkDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QrisLinkDto)
  qrisLink?: QrisLinkDto;
}
