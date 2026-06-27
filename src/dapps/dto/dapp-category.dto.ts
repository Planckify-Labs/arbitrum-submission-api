import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  IsObject,
  IsInt,
} from "class-validator";
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

  @ApiPropertyOptional({
    description: "Generalized visual-styling tokens (Appearance contract v1)",
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  appearance?: Record<string, any>;

  @ApiPropertyOptional({
    description: "Sort order within the category list (ascending)",
    default: 0,
  })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
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

  @ApiPropertyOptional({
    description: "Generalized visual-styling tokens (Appearance contract v1)",
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  appearance?: Record<string, any>;

  @ApiPropertyOptional({
    description: "Sort order within the category list (ascending)",
    default: 0,
  })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
