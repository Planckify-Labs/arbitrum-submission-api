import { ApiProperty } from "@nestjs/swagger";
import { TransactionStatus, TransactionType } from "../../../generated/prisma";

class BlockchainSummaryDto {
  @ApiProperty({ example: "Polygon" })
  name: string;

  @ApiProperty({ example: "https://polygonscan.com" })
  blockExplorer: string;
}

class TokenSummaryDto {
  @ApiProperty({ type: () => BlockchainSummaryDto })
  blockchain: BlockchainSummaryDto;

  @ApiProperty({ example: "0xeeee..." })
  contractAddress: string;

  @ApiProperty({ example: "TUSD" })
  name: string;

  @ApiProperty({ example: "TUSD" })
  symbol: string;

  @ApiProperty({ example: "https://cdn.example.com/tokens/tusd.png", required: false })
  logoUrl?: string;
}

class ProductSummaryDto {
  @ApiProperty({ example: "https://cdn.example.com/products/123.png", required: false })
  imageUrl?: string;
}

class ProductVariantSummaryDto {
  @ApiProperty({ example: "1 Month Subscription" })
  name: string;

  @ApiProperty({ type: () => ProductSummaryDto })
  product: ProductSummaryDto;
}

class PurchaseSummaryDto {
  @ApiProperty({ type: () => ProductVariantSummaryDto })
  productVariant: ProductVariantSummaryDto;
}

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

  @ApiProperty({ example: 50000 })
  amount: number;

  @ApiProperty({ example: 750000, required: false })
  amountInFiat?: number;

  @ApiProperty({ example: "IDR", required: false })
  fiatCurrency?: string;

  @ApiProperty({ example: "0x123...abc", required: false })
  txHash?: string;

  @ApiProperty({ example: "0x456...def", required: false })
  senderAddress?: string;

  @ApiProperty({ example: "0x789...ghi", required: false })
  recipientAddress?: string;

  @ApiProperty({ type: () => TokenSummaryDto, required: false })
  token?: TokenSummaryDto;

  @ApiProperty({ type: () => PurchaseSummaryDto, required: false })
  purchase?: PurchaseSummaryDto;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;
}
