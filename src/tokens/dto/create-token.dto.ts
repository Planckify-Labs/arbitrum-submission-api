import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateTokenDto {
  @ApiProperty({ example: "Tether USD" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: "USDT" })
  @IsNotEmpty()
  @IsString()
  symbol: string;

  @ApiProperty({ example: 6 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  decimals: number;

  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  blockchainId: string;

  @ApiProperty({
    example: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  contractAddress: string;

  @ApiProperty({
    example: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
    required: true,
  })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiProperty({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isStablecoin?: boolean;

  @ApiProperty({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}
