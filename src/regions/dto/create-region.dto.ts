import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateRegionDto {
  @ApiProperty({ example: "ID" })
  @IsNotEmpty()
  @IsString()
  @Length(2, 2)
  code: string;

  @ApiProperty({ example: "Indonesia" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: "IDR" })
  @IsNotEmpty()
  @IsString()
  @Length(3, 3)
  currencyCode: string;

  @ApiProperty({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ example: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hasKYCRequirement?: boolean;

  @ApiProperty({ example: 11 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  taxRate: number;

  @ApiProperty({ example: "support-id@takumipay.xyz", required: false })
  @IsOptional()
  @IsString()
  supportEmail?: string;

  @ApiProperty({ example: "+62123456789", required: false })
  @IsOptional()
  @IsString()
  supportPhone?: string;
}
