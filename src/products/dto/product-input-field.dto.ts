import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateIf,
  IsObject,
} from "class-validator";
import { InputFieldType } from "@generated/prisma";

export class FormFieldDto {
  @ApiProperty({
    description: "Key identifier for the input field",
    example: "no_hp",
  })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({
    description: "Type of input field",
    enum: InputFieldType,
    example: InputFieldType.TEXT,
  })
  @IsEnum(InputFieldType)
  type: InputFieldType;

  @ApiProperty({
    description: "Display name for the input field",
    example: "Phone Number",
  })
  @IsString()
  @IsNotEmpty()
  alias: string;

  @ApiProperty({
    description: "Description of the input field",
    example: "Enter your phone number in international format",
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: "Whether the field is required",
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @ApiProperty({
    description: "Options for dropdown/select fields",
    example: ["Asia-Pacific", "Europe", "N.America", "S.America"],
    required: false,
    type: [String],
  })
  @IsArray()
  @ValidateIf((o) => o.type === InputFieldType.OPTION)
  @IsOptional()
  options?: string[];
}

export class CreateProductInputFieldDto {
  @ApiProperty({
    description: "Form fields configuration",
    type: [FormFieldDto],
  })
  @IsArray()
  @IsNotEmpty()
  fields: FormFieldDto[];
}

export class UpdateProductInputFieldDto {
  @ApiProperty({
    description: "Form fields configuration",
    type: [FormFieldDto],
    required: false,
  })
  @IsArray()
  @IsOptional()
  fields?: FormFieldDto[];
}

export class ProductInputFieldResponseDto {
  @ApiProperty({
    description: "Unique identifier for the input field",
    example: "01H1G5V...",
  })
  id: string;

  @ApiProperty({
    description: "Product ID this field belongs to",
    example: "01H1G5V...",
  })
  productId: string;

  @ApiProperty({
    description: "Form fields configuration",
    type: [FormFieldDto],
  })
  forms: FormFieldDto[];

  @ApiProperty({
    description: "Creation timestamp",
    example: "2024-03-15T12:00:00Z",
  })
  createdAt: Date;

  @ApiProperty({
    description: "Last update timestamp",
    example: "2024-03-15T12:00:00Z",
  })
  updatedAt: Date;
}
