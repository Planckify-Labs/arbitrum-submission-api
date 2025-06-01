import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateRegionTokenDto {
  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  tokenId: string;

  @ApiProperty({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ example: 10, required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  minAmount?: number;

  @ApiProperty({ example: 1000, required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  maxAmount?: number;

  @ApiProperty({ example: 1.5 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  processingFee: number;

  @ApiProperty({ example: 5, required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  networkFeeEstimate?: number;

  @ApiProperty({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isDefault?: boolean;

  @ApiProperty({
    example: "KYC required for amounts over 1000 USD",
    required: false,
  })
  @IsOptional()
  @IsString()
  regulatoryNotes?: string;
}
