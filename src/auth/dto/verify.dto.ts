import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class VerifyDto {
  @ApiProperty({
    description: "SIWE message that was signed",
    example:
      "com.cstralpt.takumipay wants you to sign in with your Ethereum account:\n0x123...abc\n\nSign in to TakumiPay Mobile App\n\nURI: takumipay://wallet-auth\nVersion: 1\nNonce: 123abc...\nIssued At: 2025-07-19T12:00:00.000Z",
  })
  @IsString()
  message: string;

  @ApiProperty({
    description: "Signature of the SIWE message",
    example: "0x123abc...",
  })
  @IsString()
  signature: string;
}
