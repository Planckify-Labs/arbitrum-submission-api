import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { UserRole, UserStatus } from "@generated/prisma";
import { CursorPaginationDto } from "../../dto/common/pagination.dto";
import { IsNumber } from "class-validator";

export class UsersQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: "Maximum number of records to return",
    example: 50,
    default: 50,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  declare take?: number;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: "Search by username, email, name, walletAddress" })
  @IsOptional()
  @IsString()
  search?: string;
}
