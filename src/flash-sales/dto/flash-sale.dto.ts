import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsPositive,
  IsInt,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";

export class CreateFlashSaleDto {
  @ApiProperty({ description: "ID of the product variant to apply the flash sale to" })
  @IsString()
  @IsNotEmpty()
  productVariantId: string;

  @ApiProperty({ description: "ID of the product price to reference for savings calculation" })
  @IsString()
  @IsNotEmpty()
  productPriceId: string;

  @ApiProperty({ description: "Discounted price for the flash sale", example: 9.99 })
  @IsNumber()
  @IsPositive()
  discountedPrice: number;

  @ApiProperty({ description: "Currency code for the discounted price", example: "IDR" })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({ description: "ISO 8601 datetime when the flash sale starts", example: "2026-04-01T00:00:00.000Z" })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ description: "ISO 8601 datetime when the flash sale ends", example: "2026-04-01T23:59:59.000Z" })
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional({ description: "Maximum number of redemptions allowed (null = unlimited)", example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;
}

export class UpdateFlashSaleDto extends PartialType(CreateFlashSaleDto) {
  @ApiPropertyOptional({ description: "Whether the flash sale is active", example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
