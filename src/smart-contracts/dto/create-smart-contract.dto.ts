import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsBoolean, IsOptional, IsInt, Min } from "class-validator";

export class CreateSmartContractDto {
  @ApiProperty({
    description: "The name of the smart contract",
    example: "Payment Processor",
  })
  @IsString()
  name: string;

  @ApiProperty({
    description:
      "The category of the smart contract, e.g. payment, gateway, protocol",
    example: "payment",
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: "The contract version",
    example: 1,
    default: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;

  @ApiProperty({
    description: "The blockchain ID where the contract is deployed",
    example: "01H1G5V...",
  })
  @IsString()
  blockchainId: string;

  @ApiProperty({
    description: "The contract address or program ID on the blockchain",
    example: "0x... or Base58 program ID",
  })
  @IsString()
  address: string;

  @ApiProperty({
    description: "Whether the contract is active",
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
