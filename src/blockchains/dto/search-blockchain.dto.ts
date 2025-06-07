import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsInt, IsBoolean, IsOptional } from "class-validator";
import { Transform } from "class-transformer";

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
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  isEVM?: boolean;

  @ApiProperty({
    description: "Filter by active status",
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  isActive?: boolean;
}
