import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsString, MinLength } from "class-validator";

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
    example: "ios",
  })
  @IsString()
  platform: string;

  @ApiProperty({
    description:
      "All wallet addresses currently held on this device. Any chain format accepted.",
    type: [String],
    example: ["0xabc...", "BPFLoader2..."],
  })
  @IsArray()
  @IsString({ each: true })
  wallets: string[];
}
