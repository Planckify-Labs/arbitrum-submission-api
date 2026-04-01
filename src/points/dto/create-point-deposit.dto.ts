import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";

export class CreatePointDepositDto {
  @ApiProperty({ description: "Reference ID used in smart contract createTransaction()" })
  @IsString()
  @IsNotEmpty()
  refId: string;

  @ApiProperty({ description: "On-chain transaction hash" })
  @IsString()
  @IsNotEmpty()
  txHash: string;

  @ApiProperty({ description: "Token ID used for deposit" })
  @IsString()
  @IsNotEmpty()
  tokenId: string;

  @ApiProperty({ description: "Blockchain ID the deposit was made on" })
  @IsString()
  @IsNotEmpty()
  blockchainId: string;

  @ApiProperty({ description: "Smart contract address the deposit was sent to" })
  @IsString()
  @IsNotEmpty()
  contractAddress: string;

  @ApiProperty({ description: "User wallet address (must belong to authenticated user)" })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({ description: "Raw token amount in smallest unit (e.g. 50000000 for 50 USDT with 6 decimals)" })
  @IsString()
  @IsNotEmpty()
  tokenAmount: string;

  @ApiProperty({ description: "Client-calculated expected points (informational only, server recalculates)" })
  @IsString()
  @IsNotEmpty()
  expectedPoints: string;

  @ApiPropertyOptional({ description: 'Fiat currency for point rate calculation (default: "IDR")' })
  @IsOptional()
  @IsString()
  currency?: string;
}
