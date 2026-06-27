import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  IsObject,
  IsInt,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateDappDto {
  @ApiProperty({ description: "Name of the dapp" })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: "Description of the dapp" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Logo URL of the dapp" })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiProperty({ description: "Website URL of the dapp" })
  @IsUrl()
  websiteUrl: string;

  @ApiProperty({ description: "Category ID of the dapp" })
  @IsString()
  categoryId: string;

  @ApiPropertyOptional({
    description: "Whether the dapp is popular",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({
    description: "Whether the dapp is sponsored",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isSponsor?: boolean;

  @ApiPropertyOptional({
    description: "Whether the dapp is highlighted",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isHighlight?: boolean;

  @ApiPropertyOptional({
    description: "Whether the dapp is active",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      "Generalized visual-styling tokens (Appearance contract v1). " +
      "Replaces the old flat bgColor.",
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  appearance?: Record<string, any>;

  @ApiPropertyOptional({
    description: "Sort order within listings (ascending)",
    default: 0,
  })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateDappDto {
  @ApiPropertyOptional({ description: "Name of the dapp" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "Description of the dapp" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Logo URL of the dapp" })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ description: "Website URL of the dapp" })
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @ApiPropertyOptional({ description: "Category ID of the dapp" })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: "Whether the dapp is popular" })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ description: "Whether the dapp is sponsored" })
  @IsOptional()
  @IsBoolean()
  isSponsor?: boolean;

  @ApiPropertyOptional({ description: "Whether the dapp is highlighted" })
  @IsOptional()
  @IsBoolean()
  isHighlight?: boolean;

  @ApiPropertyOptional({ description: "Whether the dapp is active" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      "Generalized visual-styling tokens (Appearance contract v1). " +
      "Replaces the old flat bgColor.",
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  appearance?: Record<string, any>;

  @ApiPropertyOptional({
    description: "Sort order within listings (ascending)",
    default: 0,
  })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
