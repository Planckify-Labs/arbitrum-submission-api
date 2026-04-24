import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, Matches, Min } from "class-validator";

export class OnchainSubmitDto {
  @ApiProperty({ description: "0x-prefixed transaction hash" })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/, { message: "txHash must be a valid 0x-prefixed 32-byte hex string" })
  txHash!: string;

  @ApiProperty({ description: "EVM chain ID where the transaction was submitted" })
  @IsInt()
  @Min(1)
  chainId!: number;
}
