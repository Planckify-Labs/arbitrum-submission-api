import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";

interface ApiLogMetadata {
  service?: string;
  version?: string;
  environment?: string;
  [key: string]: unknown;
}

export class SearchApiLogDto {
  @ApiProperty({
    description: "Request ID to search for",
    example: "req_123456789",
    required: false,
  })
  @IsString()
  @IsOptional()
  requestId?: string;

  @ApiProperty({
    description: "User ID to filter logs",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiProperty({
    description: "Service name to filter logs",
    example: "product-service",
    required: false,
  })
  @IsString()
  @IsOptional()
  service?: string;

  @ApiProperty({
    description: "Endpoint path to filter logs",
    example: "/api/v1/products",
    required: false,
  })
  @IsString()
  @IsOptional()
  endpoint?: string;

  @ApiProperty({
    description: "HTTP method to filter logs",
    example: "GET",
    required: false,
  })
  @IsString()
  @IsOptional()
  method?: string;

  @ApiProperty({
    description: "Filter by success status",
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  success?: boolean;
}

export class ApiLogResponseDto {
  @ApiProperty({
    description: "API Log ID",
    example: "01H1G5V...",
  })
  id: string;

  @ApiProperty({
    description: "Unique request identifier",
    example: "req_123456789",
  })
  requestId: string;

  @ApiProperty({
    description: "API endpoint path",
    example: "/api/v1/products",
  })
  endpoint: string;

  @ApiProperty({
    description: "HTTP method",
    example: "GET",
  })
  method: string;

  @ApiProperty({
    description: "Service name",
    example: "product-service",
  })
  service: string;

  @ApiProperty({
    description: "Request body data",
    example: { category: "Gaming Top Up" },
  })
  requestBody: Record<string, unknown>;

  @ApiProperty({
    description: "Response body data",
    example: { success: true, data: [{ id: "1", name: "Mobile Legends" }] },
  })
  responseBody?: Record<string, unknown>;

  @ApiProperty({
    description: "HTTP status code",
    example: 200,
  })
  statusCode?: number;

  @ApiProperty({
    description: "Whether the request was successful",
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: "Error message if request failed",
    example: "Product not found",
  })
  errorMessage?: string;

  @ApiProperty({
    description: "Request duration in milliseconds",
    example: 120,
  })
  duration: number;

  @ApiProperty({
    description: "Client IP address",
    example: "192.168.1.1",
  })
  ipAddress?: string;

  @ApiProperty({
    description: "Client user agent string",
    example: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  })
  userAgent?: string;

  @ApiProperty({
    description: "Associated user ID",
    example: "01H1G5V...",
  })
  userId?: string;

  @ApiProperty({
    description: "Additional metadata",
    example: {
      service: "product-service",
      version: "1.0.0",
      environment: "production",
    },
  })
  metadata?: ApiLogMetadata;

  @ApiProperty({
    description: "Creation timestamp",
    example: "2024-03-15T12:00:00Z",
  })
  createdAt: Date;
}
