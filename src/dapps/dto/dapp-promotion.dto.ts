import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  IsObject,
  IsInt,
  IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateDappPromotionDto {
  @ApiProperty({ description: "Banner headline" })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: "Banner subtitle" })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiPropertyOptional({ description: "Banner body copy" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: "Banner artwork URL" })
  @IsUrl()
  imageUrl: string;

  @ApiPropertyOptional({
    description: "Generalized visual-styling tokens (Appearance contract v1)",
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  appearance?: Record<string, any>;

  @ApiPropertyOptional({ description: "URL the banner opens" })
  @IsOptional()
  @IsUrl()
  targetUrl?: string;

  @ApiPropertyOptional({ description: "Linked dapp id (alternative to URL)" })
  @IsOptional()
  @IsString()
  dappId?: string;

  @ApiPropertyOptional({
    description: "Show the SPONSORED badge",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isSponsored?: boolean;

  @ApiPropertyOptional({
    description: "Whether the banner is live",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Carousel order (ascending)",
    default: 0,
  })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: "Campaign start (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: "Campaign end (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class UpdateDappPromotionDto {
  @ApiPropertyOptional({ description: "Banner headline" })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: "Banner subtitle" })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiPropertyOptional({ description: "Banner body copy" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Banner artwork URL" })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: "Generalized visual-styling tokens (Appearance contract v1)",
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  appearance?: Record<string, any>;

  @ApiPropertyOptional({ description: "URL the banner opens" })
  @IsOptional()
  @IsUrl()
  targetUrl?: string;

  @ApiPropertyOptional({ description: "Linked dapp id (alternative to URL)" })
  @IsOptional()
  @IsString()
  dappId?: string;

  @ApiPropertyOptional({ description: "Show the SPONSORED badge" })
  @IsOptional()
  @IsBoolean()
  isSponsored?: boolean;

  @ApiPropertyOptional({ description: "Whether the banner is live" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "Carousel order (ascending)" })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: "Campaign start (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: "Campaign end (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
