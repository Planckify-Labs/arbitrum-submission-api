import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateExchangeRateDto {
  @ApiProperty({ description: "Currency to convert from" })
  @IsString()
  fromCurrency: string;

  @ApiProperty({ description: "Currency to convert to" })
  @IsString()
  toCurrency: string;

  @ApiProperty({ description: "Exchange rate value" })
  @IsNumber()
  @Type(() => Number)
  rate: number;

  @ApiProperty({ description: "Source provider ID" })
  @IsString()
  sourceProviderId: string;

  @ApiPropertyOptional({ description: "Region code (optional)" })
  @IsString()
  @IsOptional()
  region?: string;

  @ApiPropertyOptional({ description: "Provider name (optional)" })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({ description: "Markup percentage (optional)" })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  markup?: number;
}

export class GetLatestExchangeRateDto {
  @ApiPropertyOptional({ description: "Currency to convert from" })
  @IsString()
  @IsOptional()
  fromCurrency?: string;

  @ApiPropertyOptional({ description: "Currency to convert to" })
  @IsString()
  @IsOptional()
  toCurrency?: string;
}

export class ExchangeRateResponseDto {
  @ApiProperty({ description: "Exchange rate ID" })
  id: number;

  @ApiProperty({ description: "Currency to convert from" })
  fromCurrency: string;

  @ApiProperty({ description: "Currency to convert to" })
  toCurrency: string;

  @ApiProperty({ description: "Exchange rate value" })
  rate: number;

  @ApiProperty({ description: "Source provider information" })
  sourceProvider: {
    id: string;
    name: string;
  };

  @ApiPropertyOptional({ description: "Region code" })
  region?: string;

  @ApiPropertyOptional({ description: "Provider name" })
  provider?: string;

  @ApiPropertyOptional({ description: "Markup percentage" })
  markup?: number;

  @ApiProperty({ description: "Whether the rate is active" })
  isActive: boolean;

  @ApiProperty({ description: "Rate timestamp" })
  createdAt: Date;

  @ApiProperty({ description: "Cursor for pagination" })
  cursor: string;
}

export class QueryExchangeRateDto {
  @ApiPropertyOptional({ description: "Currency to convert from" })
  @IsString()
  @IsOptional()
  fromCurrency?: string;

  @ApiPropertyOptional({ description: "Currency to convert to" })
  @IsString()
  @IsOptional()
  toCurrency?: string;

  @ApiPropertyOptional({ description: "Region code" })
  @IsString()
  @IsOptional()
  region?: string;

  @ApiPropertyOptional({ description: "Provider name" })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({ description: "Filter by active status" })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ description: "Start date for rate lookup" })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: "End date for rate lookup" })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    description: "Cursor for pagination (base64 encoded timestamp and ID)",
    example: "MTcxMTY0NjgwMDAwMF8x",
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: "Number of records to take (min: 1, max: 100)",
    minimum: 1,
    maximum: 100,
    default: 10,
    example: 10,
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  take?: number;
}

export class CursorPaginatedExchangeRateResponse {
  @ApiProperty({
    description: "List of exchange rates",
    type: [ExchangeRateResponseDto],
  })
  data: ExchangeRateResponseDto[];

  @ApiProperty({ description: "Number of records returned" })
  count: number;

  @ApiProperty({ description: "Cursor for the next page", required: false })
  nextCursor?: string;

  @ApiProperty({ description: "Whether there are more records available" })
  hasMore: boolean;
}
