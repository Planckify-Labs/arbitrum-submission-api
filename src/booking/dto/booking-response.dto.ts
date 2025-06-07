import { ApiProperty } from "@nestjs/swagger";
import { BookingStatus } from "../enums/booking-status.enum";

export class ProductPriceResponseDto {
  @ApiProperty({
    description: "Price amount in the specified currency",
    example: 100000,
  })
  amount: number;

  @ApiProperty({
    description: "Currency code",
    example: "IDR",
  })
  currency: string;
}

export class ProductDetailsResponseDto {
  @ApiProperty({
    description: "Product ID",
    example: "01H1G5V...",
  })
  id: string;

  @ApiProperty({
    description: "Product name",
    example: "Mobile Legends",
  })
  name: string;

  @ApiProperty({
    description: "Product price details",
    type: ProductPriceResponseDto,
  })
  price: ProductPriceResponseDto;
}

export class TokenDetailsResponseDto {
  @ApiProperty({
    description: "Token symbol",
    example: "USDC",
  })
  symbol: string;

  @ApiProperty({
    description: "Token contract address on the blockchain",
    example: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  })
  address: string;

  @ApiProperty({
    description: "Token amount",
    example: "10.5",
  })
  amount: string;

  @ApiProperty({
    description: "ID of the blockchain from the blockchain table",
    example: "01JX2FJZ7Y37Y9XXDHYP323P0X",
  })
  blockchainId: string;

  @ApiProperty({
    description: "Name of the blockchain",
    example: "Polygon",
  })
  blockchainName: string;
}

export class ExchangeRateResponseDto {
  @ApiProperty({
    description: "Exchange rate value",
    example: 15700,
  })
  rate: number;

  @ApiProperty({
    description: "Timestamp when the rate was locked",
    example: "2024-03-15T12:00:00Z",
  })
  lockedAt: string;
}

export class PaymentResponseDto {
  @ApiProperty({
    description: "Token details",
    type: TokenDetailsResponseDto,
  })
  token: TokenDetailsResponseDto;

  @ApiProperty({
    description: "Exchange rate details",
    type: ExchangeRateResponseDto,
  })
  exchangeRate: ExchangeRateResponseDto;
}

export class BookingResponseDto {
  @ApiProperty({
    description: "Booking ID",
    example: "01H1G5V...",
  })
  id: string;

  @ApiProperty({
    description: "Wallet address",
    example: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  })
  walletAddress: string;

  @ApiProperty({
    description: "Product details",
    type: ProductDetailsResponseDto,
  })
  product: ProductDetailsResponseDto;

  @ApiProperty({
    description: "Payment details with locked exchange rate",
    type: PaymentResponseDto,
  })
  payment: PaymentResponseDto;

  @ApiProperty({
    description: "Booking status",
    enum: BookingStatus,
    example: BookingStatus.PENDING,
  })
  status: BookingStatus;

  @ApiProperty({
    description: "Expiration timestamp",
    example: "2024-03-15T12:15:00Z",
  })
  expiresAt: string;

  @ApiProperty({
    description: "Creation timestamp",
    example: "2024-03-15T12:00:00Z",
  })
  createdAt: string;

  @ApiProperty({
    description: "Last update timestamp",
    example: "2024-03-15T12:00:00Z",
  })
  updatedAt: string;
}
