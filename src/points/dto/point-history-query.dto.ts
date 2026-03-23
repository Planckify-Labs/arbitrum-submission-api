import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { PointTransactionType, PointTransactionStatus } from "@generated/prisma";

export class PointHistoryQueryDto {
  @ApiPropertyOptional({ enum: PointTransactionType })
  @IsOptional()
  @IsEnum(PointTransactionType)
  type?: PointTransactionType;

  @ApiPropertyOptional({ enum: PointTransactionStatus })
  @IsOptional()
  @IsEnum(PointTransactionStatus)
  status?: PointTransactionStatus;

  @ApiPropertyOptional({ description: "Cursor for pagination" })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: "Page size (default 20, max 50)", default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
