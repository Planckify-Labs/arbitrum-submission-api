import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty } from "class-validator";

export class OnchainSubmitDto {
  @ApiProperty({ description: "Transaction hash (0x-prefixed hex for EVM) or signature (base58 for Solana)" })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @ApiProperty({ description: "Blockchain ULID — backend resolves chainId / cluster from it" })
  @IsString()
  @IsNotEmpty()
  blockchainId!: string;
}
