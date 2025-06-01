import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsDateString } from "class-validator";
import { TransactionStatus, TransactionType } from "@generated/prisma";

export class SearchTransactionDto {
  @ApiProperty({ enum: TransactionType, required: false })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({ enum: TransactionStatus, required: false })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiProperty({ example: "01H1G5V...", required: false })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ example: "01H1G5V...", required: false })
  @IsOptional()
  @IsString()
  tokenId?: string;

  @ApiProperty({ example: "0x123...abc", required: false })
  @IsOptional()
  @IsString()
  fromAddress?: string;

  @ApiProperty({ example: "0x456...def", required: false })
  @IsOptional()
  @IsString()
  toAddress?: string;

  @ApiProperty({ example: "2024-03-14T00:00:00.000Z", required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ example: "2024-03-14T23:59:59.999Z", required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
