import { ApiProperty } from "@nestjs/swagger";
import { TransactionStatus, TransactionType } from "../../../generated/prisma";

export class TransactionResponseDto {
  @ApiProperty({ example: "01H1G5V..." })
  id: string;

  @ApiProperty({ example: "01H1G5V..." })
  userId: string;

  @ApiProperty({ example: "01H1G5V..." })
  tokenId: string;

  @ApiProperty({ enum: TransactionType, example: "PAYMENT" })
  type: TransactionType;

  @ApiProperty({ enum: TransactionStatus, example: "COMPLETED" })
  status: TransactionStatus;

  @ApiProperty({ example: "50000" })
  amount: number;

  @ApiProperty({ example: "750000" })
  amountInIDR: number;

  @ApiProperty({ example: "0x123...abc", required: false })
  txHash?: string;

  @ApiProperty({ example: "0x456...def", required: false })
  fromAddress?: string;

  @ApiProperty({ example: "0x789...ghi", required: false })
  toAddress?: string;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;
}
