import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";

export class CrossChainQuoteDto {
  @ApiProperty({ description: "Source EVM chain id." })
  @IsInt()
  @Min(1)
  fromChainId: number;

  @ApiProperty({ description: "Destination EVM chain id." })
  @IsInt()
  @Min(1)
  toChainId: number;

  @ApiProperty({
    description:
      "Source token contract address (lowercased). Use 0xeeee...eeee for the native token.",
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  fromTokenContract: string;

  @ApiProperty({
    description:
      "Destination token contract address (lowercased). Use 0xeeee...eeee for the native token.",
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  toTokenContract: string;

  @ApiProperty({
    description: "Amount in source-token smallest unit (decimal string).",
  })
  @IsString()
  @Matches(/^[0-9]+$/)
  amountRaw: string;

  @ApiPropertyOptional({
    description:
      "Destination wallet address. Defaults to the JWT-bound wallet when omitted.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  toAddress?: string;
}
