import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsEthereumAddress,
} from "class-validator";

export class CreateSmartContractDto {
  @ApiProperty({
    description: "The name of the smart contract",
    example: "USDT Token Contract",
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: "The blockchain ID where the contract is deployed",
    example: "01H1G5V...",
  })
  @IsString()
  blockchainId: string;

  @ApiProperty({
    description: "The contract address on the blockchain",
    example: "0x...",
  })
  @IsEthereumAddress()
  address: string;

  @ApiProperty({
    description: "The ABI ID for the contract",
    example: "01H1G5V...",
  })
  @IsString()
  abiId: string;

  @ApiProperty({
    description: "Whether the contract is active",
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
