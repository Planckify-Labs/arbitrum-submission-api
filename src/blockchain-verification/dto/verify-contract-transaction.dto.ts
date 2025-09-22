import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export class VerifyContractTransactionDto {
  @ApiProperty({
    description: "Reference ID for the transaction",
    example: "ref_123456789",
  })
  @IsNotEmpty()
  @IsString()
  refId: string;

  @ApiProperty({
    description: "Smart contract address",
    example: "0x1234567890123456789012345678901234567890",
  })
  @IsNotEmpty()
  @IsString()
  contractAddress: string;

  @ApiProperty({
    description: "Blockchain chain ID",
    example: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  chainId: number;

  @ApiProperty({
    description: "Expected wallet address",
    example: "0x1234567890123456789012345678901234567890",
  })
  @IsNotEmpty()
  @IsString()
  expectedWalletAddress: string;

  @ApiProperty({
    description: "Expected token address",
    example: "0x1234567890123456789012345678901234567890",
  })
  @IsNotEmpty()
  @IsString()
  expectedTokenAddress: string;

  @ApiProperty({
    description: "Expected transaction amount",
    example: "1000000000000000000",
  })
  @IsNotEmpty()
  @IsString()
  expectedAmount: string;

  @ApiProperty({
    description: "Expected booking ID",
    example: "booking_123456",
  })
  @IsNotEmpty()
  @IsString()
  expectedBookingId: string;

  @ApiProperty({
    description: "Expected exchange rate ID",
    example: "rate_789012",
  })
  @IsNotEmpty()
  @IsString()
  expectedExchangeRateId: string;

  @ApiProperty({
    description: "Expected product variant ID",
    example: "variant_345678",
  })
  @IsNotEmpty()
  @IsString()
  expectedProductVariantId: string;
}