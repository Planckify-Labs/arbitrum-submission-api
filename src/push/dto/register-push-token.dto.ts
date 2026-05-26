import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Matches, MinLength } from "class-validator";

export class RegisterPushTokenDto {
  @ApiProperty({
    description:
      'Expo push token. Format: "ExponentPushToken[…]" or "ExpoPushToken[…]".',
  })
  @IsString()
  @MinLength(16)
  token: string;

  @ApiProperty({
    description: "Device platform.",
    enum: ["ios", "android", "web"],
  })
  @IsString()
  @IsIn(["ios", "android", "web"])
  platform: "ios" | "android" | "web";

  @ApiPropertyOptional({
    description:
      "Optional Android notification channel id the client registered. The server can route channelId-aware payloads when set.",
  })
  @IsOptional()
  @IsString()
  androidChannelId?: string;

  @ApiPropertyOptional({
    description:
      "Optional wallet address for wallet-scoped pushes (lowercased).",
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  walletAddress?: string;
}
