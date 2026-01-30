import { ApiProperty } from "@nestjs/swagger";

export class PaymentFeaturedIdDto {
  @ApiProperty({
    description: "Item ID",
    example: "01HXYZ123456789ABCDEF",
  })
  id: string;
}

export class PaymentFeaturedResponseDto {
  @ApiProperty({ type: PaymentFeaturedIdDto })
  "Pulsa & Data Package"?: PaymentFeaturedIdDto;

  @ApiProperty({ type: PaymentFeaturedIdDto })
  "Gaming"?: PaymentFeaturedIdDto;

  @ApiProperty({ type: PaymentFeaturedIdDto })
  "Token PLN"?: PaymentFeaturedIdDto;

  [key: string]: PaymentFeaturedIdDto | undefined;
}
