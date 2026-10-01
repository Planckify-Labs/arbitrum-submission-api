/**
 * Swap DTOs — CAIP-2 / CAIP-19 shaped.
 *
 * Spec: docs/swap-capability-spec.md §7.1.
 */

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const CAIP19 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}\/[-a-z0-9]{3,32}(?::.{1,128})?$/;
const CHAIN_ADDRESS = /^[a-zA-Z0-9:_.-]{16,128}$/;
const AMOUNT_RAW = /^[0-9]{1,78}$/;

export class SwapQuoteDto {
  @ApiProperty({ description: "Chain, CAIP-2.", example: "eip155:5042" })
  @IsString()
  @Matches(CAIP2, { message: "chain must be a CAIP-2 chain id" })
  chain: string;

  @ApiProperty({
    description: "Asset being sold, CAIP-19.",
    example: "eip155:5042/erc20:0x3600000000000000000000000000000000000000",
  })
  @IsString()
  @Matches(CAIP19, { message: "fromAsset must be a CAIP-19 asset id" })
  fromAsset: string;

  @ApiProperty({
    description: "Asset being bought, CAIP-19.",
    example: "eip155:5042/erc20:0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1",
  })
  @IsString()
  @Matches(CAIP19, { message: "toAsset must be a CAIP-19 asset id" })
  toAsset: string;

  @ApiProperty({
    description: "Amount of fromAsset to swap, smallest unit.",
    example: "1000000",
  })
  @IsString()
  @Matches(AMOUNT_RAW, { message: "amountRaw must be an integer string" })
  amountRaw: string;

  @ApiProperty({
    description: "Sending and receiving wallet address.",
    example: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  })
  @IsString()
  @Matches(CHAIN_ADDRESS, { message: "fromAddress must be a valid address" })
  fromAddress: string;

  // No slippage and no speed hint: slippage is a server-side default per
  // route class, never client- or model-supplied (swap spec §1, §7.2).
}

export class SwapStatusQueryDto {
  @ApiProperty({ description: "Chain, CAIP-2.", example: "eip155:5042" })
  @IsString()
  @Matches(CAIP2, { message: "chain must be a CAIP-2 chain id" })
  chain: string;

  @ApiProperty({
    description: "Transaction hash from swap execution.",
    example: "0x1234...",
  })
  @IsString()
  txHash: string;

  @ApiPropertyOptional({
    description: "Provider key (e.g. 'tower' or 'lifi').",
  })
  @IsOptional()
  @IsString()
  provider?: string;
}
