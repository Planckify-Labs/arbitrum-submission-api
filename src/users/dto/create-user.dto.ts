import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsEnum, IsOptional, IsString } from "class-validator";
import { AuthProvider } from "@generated/prisma";

export class CreateUserDto {
  @ApiProperty({ example: "0x123...abc", required: false })
  @IsOptional()
  @IsString()
  walletAddress?: string;

  @ApiProperty({ example: "user@example.com", required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: "John Doe", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: "https://example.com/profile.jpg", required: false })
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiProperty({ example: "WALLET", enum: AuthProvider })
  @IsEnum(AuthProvider)
  authProvider: AuthProvider;

  @ApiProperty({ example: "123456789", required: false })
  @IsOptional()
  @IsString()
  socialId?: string;

  @ApiProperty({ example: "01H1G5V...", required: false })
  @IsOptional()
  @IsString()
  regionId?: string;
}
