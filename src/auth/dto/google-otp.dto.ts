import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";

export class VerifyGoogleOtpDto {
  @ApiProperty({
    description: "Challenge id returned by POST /auth/google",
    example: "9f2c1e...",
  })
  @IsNotEmpty()
  @IsString()
  challengeId: string;

  @ApiProperty({
    description: "Six-digit verification code emailed to the user",
    example: "483920",
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{6}$/, { message: "Verification code must be six digits" })
  code: string;
}

export class ResendGoogleOtpDto {
  @ApiProperty({
    description: "Challenge id returned by POST /auth/google",
    example: "9f2c1e...",
  })
  @IsNotEmpty()
  @IsString()
  challengeId: string;
}

export class LinkWalletDto {
  @ApiProperty({
    description: "Wallet address to associate with the signed-in account",
    example: "0x1234...abcd",
  })
  @IsNotEmpty()
  @IsString()
  walletAddress: string;
}

export class GoogleChallengeResponseDto {
  @ApiProperty({
    description:
      "Opaque handle for the pending verification. Not a credential — it grants nothing without the emailed code.",
  })
  challengeId: string;

  @ApiProperty({
    description: "Partially redacted destination address, for display only",
    example: "a***i@gmail.com",
  })
  emailMasked: string;

  @ApiProperty({
    description: "Seconds until the code expires",
    example: 600,
  })
  expiresInSeconds: number;
}
