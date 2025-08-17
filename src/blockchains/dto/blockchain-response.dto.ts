import { ApiProperty } from "@nestjs/swagger";

export class BlockchainResponseDto {
  @ApiProperty({
    description: "The unique identifier of the blockchain",
    example: "01H1G5V...",
  })
  id: string;

  @ApiProperty({
    description: "The name of the blockchain",
    example: "Ethereum",
  })
  name: string;

  @ApiProperty({
    description: "The chain ID of the blockchain",
    example: 1,
  })
  chainId: number;

  @ApiProperty({
    description: "The RPC URL for the blockchain",
    example: "https://mainnet.infura.io/v3/your-api-key",
  })
  rpcUrl: string;

  @ApiProperty({
    description: "The block explorer URL",
    example: "https://etherscan.io",
  })
  blockExplorer: string;

  @ApiProperty({
    description: "Whether the blockchain is EVM compatible",
    example: true,
  })
  isEVM: boolean;

  @ApiProperty({
    description: "Whether the blockchain is active",
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: "Whether the blockchain is a testnet",
    example: false,
  })
  isTestnet: boolean;

  @ApiProperty({
    description: "The creation timestamp",
    example: "2024-03-19T12:00:00.000Z",
  })
  createdAt: Date;

  @ApiProperty({
    description: "The last update timestamp",
    example: "2024-03-19T12:00:00.000Z",
  })
  updatedAt: Date;
}
