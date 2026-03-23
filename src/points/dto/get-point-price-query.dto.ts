import { IsString, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class GetPointPriceQueryDto {
  @ApiProperty({ description: "Stablecoin token ID to price against" })
  @IsString()
  @IsNotEmpty()
  tokenId: string;

  @ApiProperty({ description: 'Fiat currency code (e.g. "IDR", "USD")' })
  @IsString()
  @IsNotEmpty()
  currency: string;
}
