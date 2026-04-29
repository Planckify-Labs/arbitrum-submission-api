import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsDateString, IsString, IsInt, Min } from "class-validator";
import { Type } from "class-transformer";
import { BookingStatus } from "../enums/booking-status.enum";

export class BookingQueryDto {
  @ApiProperty({
    description: "Filter by booking status",
    enum: BookingStatus,
    enumName: "BookingStatus",
    required: false,
  })
  @IsEnum(BookingStatus)
  @IsOptional()
  status?: BookingStatus;

  @ApiProperty({
    description: "Filter by creation date from",
    example: "2024-03-15T00:00:00Z",
    required: false,
    type: Date,
  })
  @IsDateString()
  @IsOptional()
  @Type(() => Date)
  createdFrom?: Date;

  @ApiProperty({
    description: "Filter by creation date to",
    example: "2024-03-15T23:59:59Z",
    required: false,
    type: Date,
  })
  @IsDateString()
  @IsOptional()
  @Type(() => Date)
  createdTo?: Date;

  @ApiProperty({
    description: "Filter by product ID",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiProperty({
    description: "Cursor for pagination (booking ID)",
    required: false,
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiProperty({
    description: "Number of records to return",
    example: 10,
    required: false,
    type: Number,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiProperty({
    description: "Offset for pagination (used for jump-to-page)",
    example: 0,
    required: false,
    type: Number,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  skip?: number;
}

export class BookingStatsResponseDto {
  @ApiProperty({
    description: "Total number of bookings",
    example: 100,
    type: Number,
  })
  total: number;

  @ApiProperty({
    description: "Number of pending bookings",
    example: 25,
    type: Number,
  })
  pending: number;

  @ApiProperty({
    description: "Number of executed bookings",
    example: 50,
    type: Number,
  })
  executed: number;

  @ApiProperty({
    description: "Number of expired bookings",
    example: 15,
    type: Number,
  })
  expired: number;

  @ApiProperty({
    description: "Number of cancelled bookings",
    example: 10,
    type: Number,
  })
  cancelled: number;

  @ApiProperty({
    description: "Conversion rate (executed/total)",
    example: 0.5,
    type: Number,
    minimum: 0,
    maximum: 1,
  })
  conversionRate: number;

  @ApiProperty({
    description: "Average time to execution (in minutes)",
    example: 8.5,
    type: Number,
    required: false,
    minimum: 0,
  })
  avgTimeToExecution?: number;

  @ApiProperty({
    description: "Expiration rate (expired/total)",
    example: 0.15,
    type: Number,
    minimum: 0,
    maximum: 1,
  })
  expirationRate: number;
}
