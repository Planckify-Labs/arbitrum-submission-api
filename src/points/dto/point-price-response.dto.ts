import { ApiProperty } from "@nestjs/swagger";

export class PointPriceTokenDto {
  @ApiProperty() id: string;
  @ApiProperty() symbol: string;
  @ApiProperty() name: string;
  @ApiProperty() decimals: number;
  @ApiProperty() priceInCurrency: string;
}

export class PointPriceResponseDto {
  @ApiProperty() pointPrice: string;
  @ApiProperty() currency: string;
  @ApiProperty({ type: PointPriceTokenDto }) token: PointPriceTokenDto;
  @ApiProperty() pointsPerToken: string;
  @ApiProperty() tokenPerPoint: string;
  @ApiProperty() minimumPoints: number;
  @ApiProperty() minimumTokenAmount: string;
  @ApiProperty() updatedAt: string;
}
