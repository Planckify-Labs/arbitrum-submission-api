import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class SearchTokenDto {
  @ApiProperty({ example: "USDT", required: false })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiProperty({ example: "Tether", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: "01H1G5V...", required: false })
  @IsOptional()
  @IsString()
  blockchainId?: string;

  @ApiProperty({
    example: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    required: false,
  })
  @IsOptional()
  @IsString()
  contractAddress?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isStablecoin?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isActive?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isNativeCurrency?: boolean;
}
