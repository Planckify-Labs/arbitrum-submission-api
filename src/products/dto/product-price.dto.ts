import { ApiProperty, PartialType } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateProductPriceDto {
  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  vendorId: string;

  @ApiProperty({ example: 50000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  realValue: number;

  @ApiProperty({ example: 47500 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  priceFromVendor: number;

  @ApiProperty({ example: 52500 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  sellPrice: number;

  @ApiProperty({
    example: "IDR",
    description: "Currency code (e.g., IDR, USD, SGD)",
  })
  @IsNotEmpty()
  @IsString()
  currency: string;

  @ApiProperty({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}

export class UpdateProductPriceDto extends PartialType(CreateProductPriceDto) {}
