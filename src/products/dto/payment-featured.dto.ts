import { ApiProperty } from "@nestjs/swagger";

export class PaymentFeaturedItemDto {
  @ApiProperty({
    description: "Item ID",
    example: "01HXYZ123456789ABCDEF",
  })
  id: string;

  @ApiProperty({
    description: "Item name",
    example: "Pulsa & Data",
  })
  name: string;
}

export class PulsaDataFeaturedDto {
  @ApiProperty({ type: PaymentFeaturedItemDto })
  pulsaData: PaymentFeaturedItemDto;
}

export class GamingFeaturedDto {
  @ApiProperty({ type: PaymentFeaturedItemDto })
  gaming: PaymentFeaturedItemDto;
}

export class PlnFeaturedDto {
  @ApiProperty({ type: PaymentFeaturedItemDto })
  pln: PaymentFeaturedItemDto;
}

export type PaymentFeaturedResponseDto = (
  | PulsaDataFeaturedDto
  | GamingFeaturedDto
  | PlnFeaturedDto
)[];
