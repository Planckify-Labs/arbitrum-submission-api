import { IsString, IsOptional, IsBoolean, IsUrl } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateDappCategoryDto {
  @ApiProperty({ description: "Name of the dapp category" })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: "Description of the dapp category" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Icon URL of the dapp category" })
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiPropertyOptional({
    description: "Whether the category is active",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDappCategoryDto {
  @ApiPropertyOptional({ description: "Name of the dapp category" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "Description of the dapp category" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Icon URL of the dapp category" })
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiPropertyOptional({ description: "Whether the category is active" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
