import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { RedemptionStatus } from "@generated/prisma";

export class RedeemHistoryQueryDto {
  @ApiPropertyOptional({ enum: RedemptionStatus })
  @IsOptional()
  @IsEnum(RedemptionStatus)
  status?: RedemptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
