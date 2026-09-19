import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { FulfilmentRefundStatus, FulfilmentStatus } from "@generated/prisma";

export const FULFILMENT_KINDS = ["purchase", "redemption"] as const;
export type FulfilmentKindParam = (typeof FULFILMENT_KINDS)[number];

export class ListOrdersQueryDto {
  @ApiPropertyOptional({
    enum: FulfilmentStatus,
    description: "Defaults to NEEDS_RECONCILE.",
  })
  @IsOptional()
  @IsIn(Object.values(FulfilmentStatus))
  status?: FulfilmentStatus;

  @ApiPropertyOptional({ enum: FULFILMENT_KINDS })
  @IsOptional()
  @IsIn(FULFILMENT_KINDS)
  kind?: FulfilmentKindParam;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ResolveOrderDto {
  @ApiProperty({
    enum: ["delivered", "failed"],
    description:
      "`delivered`: the vendor did hand it over (optionally paste the code in `raw`). `failed`: it did not — refund the buyer in points.",
  })
  @IsIn(["delivered", "failed"])
  outcome!: "delivered" | "failed";

  @ApiPropertyOptional({
    description: "Vendor's voucher_code, when resolving as delivered by hand.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  raw?: string;

  @ApiProperty({
    description: "Why — cite the vendor ticket. Lands in the audit log.",
    minLength: 4,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  note!: string;
}

export class ListRefundsQueryDto {
  @ApiPropertyOptional({
    enum: FulfilmentRefundStatus,
    description: "Defaults to PENDING_REVIEW.",
  })
  @IsOptional()
  @IsIn(Object.values(FulfilmentRefundStatus))
  status?: FulfilmentRefundStatus;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class RefundNoteDto {
  @ApiProperty({ minLength: 4, maxLength: 2000 })
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  note!: string;
}

export class OptionalRefundNoteDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ListShapesQueryDto {
  @ApiPropertyOptional({ enum: ["exact", "template", "heuristic", "none"] })
  @IsOptional()
  @IsIn(["exact", "template", "heuristic", "none"])
  tier?: "exact" | "template" | "heuristic" | "none";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  productCode?: string;

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class VoucherTemplateDto {
  @ApiProperty({ example: "/" })
  @IsString()
  @MinLength(1)
  @MaxLength(5)
  separator!: string;

  @ApiProperty({
    example: ["Token", "Name", "Tarif", "Power", "kWh"],
    description: "Labels in vendor order; an empty string drops that segment.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  fields!: string[];

  @ApiProperty({
    example: 0,
    description: "Index of the redeemable code in `fields`.",
  })
  @IsInt()
  @Min(0)
  primary!: number;
}

export class SetVoucherTemplateDto {
  @ApiPropertyOptional({
    type: VoucherTemplateDto,
    nullable: true,
    description: "null clears the template.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => VoucherTemplateDto)
  template?: VoucherTemplateDto | null;
}

export class PreviewTemplateDto {
  @ApiProperty({ type: VoucherTemplateDto })
  @ValidateNested()
  @Type(() => VoucherTemplateDto)
  template!: VoucherTemplateDto;

  @ApiProperty({ description: "A raw voucher_code to try the template on." })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  raw!: string;
}
