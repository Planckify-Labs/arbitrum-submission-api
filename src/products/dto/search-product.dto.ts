import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { Transform } from "class-transformer";

/**
 * Parse a query-string number into a finite number, or `undefined` when
 * absent/blank/garbage. Returning `undefined` (rather than NaN) lets
 * `@IsOptional` skip validation so a bad value degrades to "no filter"
 * instead of a 400 the agent can't recover from.
 */
const toOptionalNumber = ({
  value,
}: {
  value: unknown;
}): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

export class SearchProductDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  vendorId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  active?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    required: false,
    description: "Filter products by their category UUID.",
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({
    required: false,
    description:
      "Filter products by category name (case-insensitive substring), " +
      'e.g. "gaming", "pulsa", "voucher".',
  })
  @IsOptional()
  @IsString()
  categoryName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  vendorName?: string;

  @ApiProperty({
    required: false,
    description: "Filter products by voucher status",
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  isVoucher?: boolean;

  @ApiProperty({
    required: false,
    description:
      "Minimum points cost (inclusive). Keeps only products with at least " +
      "one active variant priced at or above this many points.",
  })
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  minPoints?: number;

  @ApiProperty({
    required: false,
    description:
      "Maximum points cost (inclusive). Keeps only products with at least " +
      'one active variant priced at or below this many points (e.g. "what ' +
      'can I redeem with my balance").',
  })
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  maxPoints?: number;
}
