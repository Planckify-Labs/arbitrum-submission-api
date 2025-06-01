import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsInt, IsBoolean, IsUrl, IsOptional } from "class-validator";

export class CreateBlockchainDto {
  @ApiProperty({
    description: "The name of the blockchain",
    example: "Ethereum",
  })
  @IsString()
  name: string;

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
    description: "Whether the blockchain is EVM compatible",
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isEVM?: boolean;

  @ApiProperty({
    description: "Whether the blockchain is active",
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
