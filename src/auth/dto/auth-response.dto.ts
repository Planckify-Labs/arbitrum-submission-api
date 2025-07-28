import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "../../../generated/prisma";

export class AuthResponseDto {
  @ApiProperty({
    description: "JWT access token",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  })
  access_token: string;

  @ApiProperty({
    description: "JWT refresh token for obtaining new access tokens",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  })
  refresh_token: string;

  @ApiProperty({
    description: "User information",
    example: {
      id: "01H1G5V...",
      walletAddress: "0x123...abc",
      role: "USER",
    },
  })
  user: {
    id: string;
    walletAddress?: string;
    username?: string;
    role: UserRole;
  };
}
