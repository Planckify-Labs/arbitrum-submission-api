import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsInt, IsBoolean, IsOptional } from "class-validator";
import { Transform } from "class-transformer";

function toBool({ obj, key }: { obj: Record<string, unknown>; key: string }) {
  const raw = obj[key];
  if (raw === "true" || raw === true) return true;
  if (raw === "false" || raw === false) return false;
  return undefined;
}

export class SearchBlockchainDto {
  @ApiProperty({
    description: "Search by blockchain name",
    example: "Ethereum",
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: "Search by chain ID",
    example: 1,
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  chainId?: number;

  @ApiProperty({
    description: "Filter by EVM compatibility",
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(toBool)
  isEVM?: boolean;

  @ApiProperty({
    description: "Filter by active status",
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(toBool)
  isActive?: boolean;

  @ApiProperty({
    description: "Filter by testnet",
    example: false,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(toBool)
  isTestnet?: boolean;
}
