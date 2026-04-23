import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNotEmpty,
} from "class-validator";
import { ApiProperty, PartialType } from "@nestjs/swagger";

export class CreateExchangeSourceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  apiEndpoint?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  priority?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  updateInterval?: number;
}

export class UpdateExchangeSourceDto extends PartialType(
  CreateExchangeSourceDto,
) {}
