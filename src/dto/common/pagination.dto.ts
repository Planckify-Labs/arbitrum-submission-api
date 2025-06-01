import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString } from "class-validator";
import { Type } from "class-transformer";

export class CursorPaginationDto {
  @ApiProperty({
    description: "Number of records to take",
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  take?: number = 10;

  @ApiProperty({
    description: "Cursor for pagination (usually the ID of the last item)",
    example: "01H1G5V...",
    required: false,
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
