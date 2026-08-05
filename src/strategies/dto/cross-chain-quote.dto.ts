import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Matches, Min } from "class-validator";

/**
 * LEGACY EVM-only cross-chain quote DTO.
 *
 * Spec: docs/bridge-capability-spec.md §4.1 (mobile-app repo).
 *
 * This shape was blocker #1: every address field was
 * `@Matches(/^0x[a-fA-F0-9]{40}$/)` and every chain field `@IsInt()`, so a
 * Solana mint or a Sui coin type was LITERALLY INEXPRESSIBLE. The fix is
 * not to widen these regexes one namespace at a time — it is `/bridge/*`
 * and `BridgeQuoteDto`, which validate the CAIP-2 / CAIP-19 grammar and
 * therefore need no change when a namespace is added.
 *
 * `POST /strategies/cross-chain/quote` is retained for back-compat with
 * clients that predate the bridge surface, and stays deliberately
 * EVM-shaped: widening it to accept non-EVM identifiers it cannot route
 * would promise something the endpoint does not deliver. The token
 * fields are relaxed only enough to stop rejecting the well-known native
 * sentinel, and the destination address is no longer force-lowercased by
 * validation, because case folding is per-encoding
 * (`feedback_address_case_per_encoding`).
 *
 * New callers should use `POST /bridge/quote`.
 *
 * @deprecated Use `BridgeQuoteDto` / `POST /bridge/quote`.
 */
export class CrossChainQuoteDto {
  @ApiProperty({ description: "Source EVM chain id." })
  @IsInt()
  @Min(1)
  fromChainId: number;

  @ApiProperty({ description: "Destination EVM chain id." })
  @IsInt()
  @Min(1)
  toChainId: number;

  @ApiProperty({
    description:
      "Source token contract address. Use 0xeeee…eeee for the native token.",
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  fromTokenContract: string;

  @ApiProperty({
    description:
      "Destination token contract address. Use 0xeeee…eeee for the native token.",
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  toTokenContract: string;

  @ApiProperty({
    description: "Amount in source-token smallest unit (decimal string).",
  })
  @IsString()
  @Matches(/^[0-9]+$/)
  amountRaw: string;

  @ApiPropertyOptional({
    description:
      "Destination wallet address. Defaults to the JWT-bound wallet when omitted.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  toAddress?: string;
}
