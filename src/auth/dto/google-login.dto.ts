import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class GoogleLoginDto {
  @ApiProperty({
    description: "Google ID token from mobile client",
    example: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  })
  @IsNotEmpty()
  @IsString()
  idToken: string;

  @ApiProperty({
    description: "Platform indicator (ios/android/web)",
    example: "ios",
    required: false,
  })
  @IsOptional()
  @IsString()
  platform?: "ios" | "android" | "web";
}
