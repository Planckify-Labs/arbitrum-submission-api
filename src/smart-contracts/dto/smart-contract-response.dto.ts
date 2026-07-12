import { ApiProperty } from "@nestjs/swagger";
import { BlockchainResponseDto } from "../../blockchains/dto/blockchain-response.dto";

export class SmartContractResponseDto {
  @ApiProperty({
    description: "The unique identifier of the smart contract",
    example: "01H1G5V...",
  })
  id: string;

  @ApiProperty({
    description: "The name of the smart contract",
    example: "Payment Processor",
  })
  name: string;

  @ApiProperty({
    description:
      "The category of the smart contract, e.g. payment, gateway, protocol",
    example: "payment",
  })
  type: string;

  @ApiProperty({
    description: "The contract version",
    example: 1,
  })
  version: number;

  @ApiProperty({
    description: "The blockchain where the contract is deployed",
  })
  blockchain: BlockchainResponseDto;

  @ApiProperty({
    description: "The blockchain ID where the contract is deployed",
    example: "01H1G5V...",
  })
  blockchainId: string;

  @ApiProperty({
    description: "The contract address or program ID on the blockchain",
    example: "0x... or Base58 program ID",
  })
  address: string;

  @ApiProperty({
    description: "Whether the contract is active",
    example: true,
  })
  isActive: boolean;

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
