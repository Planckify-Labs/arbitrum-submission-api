import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { Type } from "class-transformer";

export class SearchRegionDto {
  @ApiProperty({ example: "ID", required: false })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ example: "Indonesia", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: "IDR", required: false })
  @IsOptional()
  @IsString()
  currencyCode?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hasKYCRequirement?: boolean;
}
