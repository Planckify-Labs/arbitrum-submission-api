import { ApiProperty } from "@nestjs/swagger";
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from "class-validator";
import { TransactionStatus, TransactionType } from "@generated/prisma";

export class CreateTransactionDto {
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

  @ApiProperty({ example: "1000000000000000000", description: "Amount in raw token units (e.g., wei)" })
  @IsNotEmpty()
  @IsNumberString()
  amount: string;

  @ApiProperty({ example: "750000", required: false })
  @IsOptional()
  @IsNumberString()
  amountInFiat?: string;

  @ApiProperty({ example: "IDR", required: false })
  @IsOptional()
  @IsString()
  fiatCurrency?: string;

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

  @ApiProperty({ example: "Warung Pak Budi", required: false })
  @IsOptional()
  @IsString()
  merchantName?: string;

  @ApiProperty({ example: "01H1G5V...", required: false })
  @IsOptional()
  @IsString()
  paymentIntentId?: string;
}
