import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { Prisma } from "@generated/prisma";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  IsArray,
  IsObject,
} from "class-validator";

export class CreateStrategyDto {
  @ApiProperty({
    description: "Namespace of the strategy (e.g., eip155, solana, sui)",
    enum: ["eip155", "solana", "sui"],
  })
  @IsEnum(["eip155", "solana", "sui"])
  namespace: string;

  @ApiProperty({
    description: "Risk tier of the strategy",
    enum: ["conservative", "balanced", "aggressive"],
  })
  @IsEnum(["conservative", "balanced", "aggressive"])
  tier: string;

  @ApiProperty({
    description:
      "Asset preferences (multi-select subset of stable / eth_lst / multi)",
    isArray: true,
    enum: ["stable", "eth_lst", "multi"],
    example: ["stable", "eth_lst"],
  })
  @IsArray()
  @IsEnum(["stable", "eth_lst", "multi"], { each: true })
  assetPreferences: string[];

  @ApiProperty({
    description: "Liquidity preference (e.g., instant, 7d, 30d)",
    enum: ["instant", "7d", "30d"],
  })
  @IsEnum(["instant", "7d", "30d"])
  liquidityPref: string;

  @ApiProperty({
    description: "Chain preference (JSON array of chain IDs or ['any'])",
    example: ["any"],
  })
  @IsArray()
  chainPref: Prisma.InputJsonValue;

  @ApiProperty({
    description: "Allocation percentage (1-100)",
    example: 50,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  allocationPct: number;

  @ApiProperty({
    description: "Rebalance trigger configuration (JSON)",
    example: { kind: "interval", value: "weekly" },
  })
  @IsObject()
  rebalanceTrigger: Prisma.InputJsonValue;

  @ApiPropertyOptional({
    description: "Optional whitelist of protocol slugs",
    example: ["aave-v3", "lido"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocolWhitelist?: string[];

  @ApiPropertyOptional({
    description:
      "Opt-out of curation; when true, empty protocolWhitelist means any protocol in tier",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowAllInTier?: boolean;

  @ApiPropertyOptional({
    description:
      "Opt-in to auto-compound (spec §21.3). When true, claimed rewards are redeposited into the same position via the `defi_compound` tool. Still human-in-the-loop — one signature per cycle.",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoCompound?: boolean;

  @ApiProperty({
    description: "Notification level (e.g., every, daily, alerts)",
    enum: ["every", "daily", "alerts"],
  })
  @IsEnum(["every", "daily", "alerts"])
  notificationLevel: string;
}
