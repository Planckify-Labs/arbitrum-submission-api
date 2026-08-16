import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

export class AssetPriceQueryDto {
  @ApiProperty({ description: "EVM chain id the asset lives on." })
  @IsInt()
  @Min(0)
  chain_id: number;

  @ApiProperty({ description: 'Asset symbol, e.g. "USDT" — used for native-coin lookups.' })
  @IsString()
  asset_symbol: string;

  @ApiProperty({
    required: false,
    description: "ERC-20 contract address. Omit for the chain's native coin.",
  })
  @IsOptional()
  @IsString()
  asset_contract?: string;
}

/** Batch USD spot-price request (mobile → backend → Alchemy Prices API). */
export class AssetPricesRequestDto {
  @ApiProperty({ type: [AssetPriceQueryDto] })
  @ValidateNested({ each: true })
  @Type(() => AssetPriceQueryDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  queries: AssetPriceQueryDto[];
}
