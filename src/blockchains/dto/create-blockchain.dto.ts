import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsInt, IsBoolean, IsUrl, IsOptional, IsIn } from "class-validator";
import { CHAIN_FAMILIES, type ChainFamily } from "../chain-family";

export class CreateBlockchainDto {
  @ApiProperty({
    description: "The name of the blockchain",
    example: "Ethereum",
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: "Chain family — which VM/ledger model this chain uses",
    example: "EVM",
    enum: CHAIN_FAMILIES,
  })
  @IsIn(CHAIN_FAMILIES)
  type: ChainFamily;

  @ApiProperty({
    description: "The chain ID of the blockchain",
    example: 1,
  })
  @IsInt()
  chainId: number;

  @ApiProperty({
    description: "The RPC URL for the blockchain",
    example: "https://mainnet.infura.io/v3/your-api-key",
  })
  @IsUrl()
  rpcUrl: string;

  @ApiProperty({
    description: "The block explorer URL",
    example: "https://etherscan.io",
  })
  @IsUrl()
  blockExplorer: string;

  @ApiProperty({
    description: "Whether the blockchain is active",
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({
    description: "Whether the blockchain is a testnet",
    example: false,
    default: false,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isTestnet?: boolean;
}
