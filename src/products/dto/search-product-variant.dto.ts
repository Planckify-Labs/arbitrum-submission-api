import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class SearchProductVariantDto {
  @ApiProperty({
    description: "Search by variant code (case insensitive)",
    required: false,
    example: "MLBB-60D",
  })
  @IsString()
  @IsOptional()
  variantCode?: string;

  @ApiProperty({
    description: "Search by variant name (case insensitive)",
    required: false,
    example: "60 Diamonds",
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: "Filter by product ID",
    required: false,
    example: "01H1G5V...",
  })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiProperty({
    description:
      "General search term that matches against name or variant code",
    required: false,
  })
  @IsString()
  @IsOptional()
  query?: string;

  @ApiProperty({
    description: "Filter by active status",
    required: false,
    type: Boolean,
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
