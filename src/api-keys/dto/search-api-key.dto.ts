import { ApiKeyStatus, ApiKeyType } from "@generated/prisma";
import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsEnum, IsString, IsDateString } from "class-validator";

export class SearchApiKeyDto {
  @ApiProperty({
    description: "Search by API key name",
    example: "Smart Contract",
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: "Filter by API key type",
    enum: ApiKeyType,
    example: ApiKeyType.SMART_CONTRACT,
    required: false,
  })
  @IsOptional()
  @IsEnum(ApiKeyType)
  type?: ApiKeyType;

  @ApiProperty({
    description: "Filter by API key status",
    enum: ApiKeyStatus,
    example: ApiKeyStatus.ACTIVE,
    required: false,
  })
  @IsOptional()
  @IsEnum(ApiKeyStatus)
  status?: ApiKeyStatus;

  @ApiProperty({
    description: "Filter by creation date (from)",
    example: "2024-01-01T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiProperty({
    description: "Filter by creation date (to)",
    example: "2024-12-31T23:59:59.999Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiProperty({
    description: "Filter by expiration date (from)",
    example: "2024-01-01T00:00:00.000Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  expiresFrom?: string;

  @ApiProperty({
    description: "Filter by expiration date (to)",
    example: "2024-12-31T23:59:59.999Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  expiresTo?: string;
}
