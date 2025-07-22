import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsOptional } from "class-validator";
import { Type } from "class-transformer";

export class NonceDto {
  @ApiProperty({
    description:
      "The blockchain chain ID (e.g., 1 for Ethereum Mainnet, 5 for Goerli)",
    required: false,
    default: 1,
    type: Number,
  })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  chainId?: number;
}
