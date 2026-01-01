import { ApiProperty } from "@nestjs/swagger";
import { AuthProvider } from "@generated/prisma";

export class UserResponseDto {
  @ApiProperty({ example: "01H1G5V..." })
  id: string;

  @ApiProperty({ example: "0x123...abc", required: false })
  walletAddress?: string;

  @ApiProperty({ example: "user@example.com", required: false })
  email?: string;

  @ApiProperty({ example: "John Doe", required: false })
  name?: string;

  @ApiProperty({ example: "https://example.com/profile.jpg", required: false })
  profileImage?: string;

  @ApiProperty({ example: "WALLET", enum: AuthProvider })
  authProvider: AuthProvider;

  @ApiProperty({ example: "123456789", required: false })
  socialId?: string;

  @ApiProperty({ example: "01H1G5V...", required: false })
  regionId?: string;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;
}
