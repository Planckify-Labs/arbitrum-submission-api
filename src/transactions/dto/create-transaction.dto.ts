import { ApiProperty } from "@nestjs/swagger";
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";
import { TransactionStatus, TransactionType } from "../../../generated/prisma";
import { Type } from "class-transformer";

export class CreateTransactionDto {
  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  userId: string;

  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  tokenId: string;

  @ApiProperty({ enum: TransactionType, example: "PAYMENT" })
  @IsNotEmpty()
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ enum: TransactionStatus, example: "PENDING", required: false })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiProperty({ example: 50000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  amount: number;

  @ApiProperty({ example: 750000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  amountInFiat: number;

  @ApiProperty({ example: "IDR" })
  @IsNotEmpty()
  @IsString()
  fiatCurrency: string;

  @ApiProperty({ example: "0x123...abc", required: false })
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiProperty({ example: "0x456...def", required: false })
  @IsOptional()
  @IsString()
  fromAddress?: string;

  @ApiProperty({ example: "0x789...ghi", required: false })
  @IsOptional()
  @IsString()
  toAddress?: string;
}
