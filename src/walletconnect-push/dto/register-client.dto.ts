import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export const PUSH_CLIENT_TYPES = [
  "fcm",
  "apns",
  "apns-sandbox",
  "noop",
] as const;
export type PushClientType = (typeof PUSH_CLIENT_TYPES)[number];

/** Body of `POST /clients` (WalletConnect push-server spec "Register Client"). */
export class RegisterPushClientDto {
  @ApiProperty({ description: "Relay client id of the wallet install." })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  client_id: string;

  @ApiProperty({ enum: PUSH_CLIENT_TYPES })
  @IsIn(PUSH_CLIENT_TYPES)
  type: PushClientType;

  @ApiProperty({
    description:
      'Device token. TakumiPay registers its Expo push token ("ExponentPushToken[…]"), which this server delivers through Expo.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  token: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  always_raw?: boolean;
}
