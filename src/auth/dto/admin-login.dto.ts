import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class AdminLoginDto {
  @ApiProperty({
    description: "Admin username",
    example: "admin",
  })
  @IsNotEmpty()
  @IsString()
  username: string;

  @ApiProperty({
    description: "Admin password",
    example: "password123",
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}
