import { ApiProperty } from "@nestjs/swagger";
import { TokenResponseDto } from "../../tokens/dto/token-response.dto";

export class RegionTokenResponseDto {
  @ApiProperty({ example: "01H1G5V..." })
  id: string;

  @ApiProperty({ example: "01H1G5V..." })
  regionId: string;

  @ApiProperty({ example: "01H1G5V..." })
  tokenId: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 10, required: false })
  minAmount?: number;

  @ApiProperty({ example: 1000, required: false })
  maxAmount?: number;

  @ApiProperty({ example: 1.5 })
  processingFee: number;

  @ApiProperty({ example: 5, required: false })
  networkFeeEstimate?: number;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty({
    example: "KYC required for amounts over 1000 USD",
    required: false,
  })
  regulatoryNotes?: string;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;

  @ApiProperty({ type: TokenResponseDto })
  token: TokenResponseDto;
}
