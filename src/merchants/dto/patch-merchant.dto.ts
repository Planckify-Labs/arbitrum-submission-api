import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";
import { RawString } from "../../utils/validators/raw-string.transform";

/**
 * Body shape for `PATCH /v1/merchants/me` (§6.1 MerchantPatch).
 *
 * Every field is optional — the client submits only what changed. The
 * service re-issues the JWS if any JWS-signed field (displayName) mutates
 * or the payout channel/account changes (operational rotation — §4.4).
 */
export class PatchMerchantDto {
  @ApiPropertyOptional({ description: "Updated display name." })
  @IsOptional()
  @RawString({ optional: true })
  @IsString()
  @Length(1, 80)
  displayName?: string;

  @ApiPropertyOptional({ description: "Updated Xendit channel code." })
  @IsOptional()
  @RawString({ optional: true })
  @IsString()
  @Length(1, 32)
  payoutChannel?: string;

  @ApiPropertyOptional({
    description: "Updated payout account number (phone or digits).",
  })
  @IsOptional()
  @RawString({ optional: true })
  @IsString()
  @Length(3, 64)
  payoutAccountNumber?: string;

  @ApiPropertyOptional({ description: "Updated account holder name." })
  @IsOptional()
  @RawString({ optional: true })
  @IsString()
  @Length(1, 120)
  payoutAccountHolderName?: string;

  @ApiPropertyOptional({ description: "Updated contact / WhatsApp phone." })
  @IsOptional()
  @RawString({ optional: true })
  @IsString()
  @Length(5, 32)
  contactPhone?: string;
}
