import { ApiProperty } from "@nestjs/swagger";

export class TokenResponseDto {
  @ApiProperty({ example: "01H1G5V..." })
  id: string;

  @ApiProperty({ example: "Tether USD" })
  name: string;

  @ApiProperty({ example: "USDT" })
  symbol: string;

  @ApiProperty({ example: 6 })
  decimals: number;

  @ApiProperty({ example: "01H1G5V..." })
  blockchainId: string;

  @ApiProperty({
    example: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    required: false,
  })
  contractAddress?: string;

  @ApiProperty({
    example: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
    required: false,
  })
  logoUrl?: string;

  @ApiProperty({ example: true })
  isStablecoin: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;
}
