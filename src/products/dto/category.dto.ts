import { ApiProperty, PartialType } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
} from "class-validator";
import { CategoryType } from "@generated/prisma";

export class CreateCategoryDto {
  @ApiProperty({ example: "Games" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: "Digital games and gaming products",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: "https://example.com/games.jpg", required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    example: "MAINCATEGORY",
    enum: CategoryType,
    description: "Type of category - MAINCATEGORY or SUBCATEGORY",
  })
  @IsNotEmpty()
  @IsEnum(CategoryType)
  categoryType: CategoryType;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
