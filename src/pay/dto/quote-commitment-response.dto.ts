import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Wire shape of the onchain quote commitment echoed inside
 * `PaymentIntentResponseDto`. The mobile app uses these fields to
 * build the on-chain `payWithQuote(...)` call -- the `quoteSignature`
 * (sibling field on the parent DTO) proves the backend endorsed this
 * exact commitment.
 *
 * All bigint-precision fields are serialized as strings so they survive
 * JSON round-tripping without precision loss.
 */
export class QuoteCommitmentResponseDto {
  @ApiProperty({ description: "Intent reference id (same as intent.id)." })
  refId!: string;

  @ApiProperty({ description: "Merchant id the payment is destined for." })
  merchantId!: string;

  @ApiProperty({ description: "USDC (or settlement token) contract address on the target chain." })
  tokenAddress!: string;

  @ApiProperty({ description: "Total USDC amount in atomic units (6 decimals), as a decimal string." })
  amount!: string;

  @ApiProperty({ description: "Platform fee portion in atomic units, as a decimal string." })
  platformFeeAmount!: string;

  @ApiProperty({ description: "Fiat amount in minor units (e.g. IDR cents)." })
  fiatAmountMinor!: number;

  @ApiProperty({ description: "ISO 4217 fiat currency code (e.g. `IDR`)." })
  fiatCurrency!: string;

  @ApiProperty({ description: "Exchange rate snapshot id from the `exchange_rates` table." })
  exchangeRateId!: number;

  @ApiProperty({ description: "Unix seconds -- quote is invalid after this time." })
  expiresAt!: number;
}
