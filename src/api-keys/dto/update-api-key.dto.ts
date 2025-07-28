import { ApiKeyStatus, ApiKeyType } from "@generated/prisma/client";
import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsDateString,
  IsArray,
  Min,
  Max,
} from "class-validator";

export class UpdateApiKeyDto {
  @ApiProperty({
    description: "Name of the API key",
    example: "Updated Smart Contract API Key",
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: "Description of the API key",
    example: "Updated description for smart contract interactions",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: "Type of the API key",
    enum: ApiKeyType,
    example: ApiKeyType.SMART_CONTRACT,
    required: false,
  })
  @IsOptional()
  @IsEnum(ApiKeyType)
  type?: ApiKeyType;

  @ApiProperty({
    description: "Status of the API key",
    enum: ApiKeyStatus,
    example: ApiKeyStatus.ACTIVE,
    required: false,
  })
  @IsOptional()
  @IsEnum(ApiKeyStatus)
  status?: ApiKeyStatus;

  @ApiProperty({
    description: "Permissions for the API key",
    example: ["products:read", "tokens:read", "smart-contracts:read"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @ApiProperty({
    description: "Rate limit in requests per minute",
    example: 100,
    minimum: 1,
    maximum: 10000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  rateLimit?: number;

  @ApiProperty({
    description: "Expiration date of the API key (ISO string)",
    example: "2024-12-31T23:59:59.999Z",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiProperty({
    description: "Additional metadata for the API key",
    example: { ipRestrictions: ["192.168.1.0/24"], environment: "production" },
    required: false,
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
