import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Public projection of the merchant profile (§6.1 MerchantProfile).
 *
 * What's intentionally absent: the decrypted payout account number, the
 * raw JWS private key material, and any Xendit response body. Only the
 * compact JWS (safe to share — it's what's printed on the sticker) is
 * surfaced to the client.
 */
export class MerchantResponseDto {
  @ApiProperty({ description: "Merchant ULID." })
  id!: string;

  @ApiProperty({ description: "Customer-facing name." })
  displayName!: string;

  @ApiProperty({ description: "ISO 3166-1 alpha-2 country code." })
  country!: string;

  @ApiProperty({ description: "Xendit channel code (e.g. GOPAY, BCA)." })
  payoutChannel!: string;

  @ApiProperty({
    description:
      "Last 4 characters of the payout account (display-only; never the full number).",
  })
  payoutAccountLast4!: string;

  @ApiProperty({ description: "Payout account holder name." })
  payoutAccountHolderName!: string;

  @ApiPropertyOptional({ description: "Contact / WhatsApp phone." })
  contactPhone?: string;

  @ApiPropertyOptional({ description: "Linked QRIS PAN, if claimed." })
  qrisPan?: string;

  @ApiProperty({
    description:
      "TakumiPay v1 signed QR in `takumipay:v1:<compact-JWS>` wire format. Mobile verifies offline using the bundled public JWK.",
  })
  jwsQr!: string;

  @ApiProperty({
    description: "Unix ms — when the JWS was issued (== JOSE `iat × 1000`).",
  })
  jwsIssuedAt!: number;

  @ApiPropertyOptional({ description: "Unix ms — when the JWS expires." })
  jwsExpiresAt?: number | null;

  @ApiProperty({ description: "Unix ms creation time." })
  createdAt!: number;

  @ApiProperty({ description: "Unix ms last-updated time." })
  updatedAt!: number;
}

/**
 * Response shape for `POST /v1/merchants/signup` and `POST /v1/merchants/me/rotate-qr`.
 *
 * Returned alongside the merchant projection so mobile can immediately
 * print the sticker without a second round-trip.
 */
export class MerchantWithQrResponseDto {
  @ApiProperty({ type: MerchantResponseDto })
  merchant!: MerchantResponseDto;

  @ApiProperty({
    description:
      "TakumiPay v1 signed QR in `takumipay:v1:<compact-JWS>` wire format — identical to `merchant.jwsQr`, echoed for explicit client consumption.",
  })
  jwsQr!: string;
}
