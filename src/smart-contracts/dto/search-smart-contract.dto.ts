import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsEthereumAddress,
  IsInt,
} from "class-validator";
import { Transform } from "class-transformer";

export class SearchSmartContractDto {
  @ApiProperty({
    description: "Search by contract name",
    example: "USDT",
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: "Filter by blockchain ID",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  blockchainId?: string;

  @ApiProperty({
    description: "Search by blockchain name",
    example: "Ethereum",
    required: false,
  })
  @IsString()
  @IsOptional()
  blockchainName?: string;

  @ApiProperty({
    description: "Filter by blockchain chain ID",
    example: 1,
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  chainId?: number;

  @ApiProperty({
    description: "Filter by blockchain EVM compatibility",
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  })
  isBlockchainEVM?: boolean;

  @ApiProperty({
    description: "Search by contract address",
    example: "0x...",
    required: false,
  })
  @IsEthereumAddress()
  @IsOptional()
  address?: string;

  @ApiProperty({
    description: "Filter by ABI ID",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  abiId?: string;

  @ApiProperty({
    description: "Filter by active status",
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  })
  isActive?: boolean;
}
