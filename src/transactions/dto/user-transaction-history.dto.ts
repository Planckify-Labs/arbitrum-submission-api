import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { TransactionType } from "@generated/prisma";
import { Transform } from "class-transformer";

export class UserTransactionHistoryDto {
  @ApiProperty({ 
    enum: TransactionType, 
    required: false,
    description: "Filter transactions by type (PAYMENT, REFUND, TRANSFER)",
    example: "PAYMENT"
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({
    type: Number,
    required: false,
    description: "Number of records to fetch (default: 10, max: 100)",
    example: 10
  })
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  take?: number;

  @ApiProperty({
    type: String,
    required: false,
    description: "Cursor for pagination",
    example: "01H1G5V..."
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
