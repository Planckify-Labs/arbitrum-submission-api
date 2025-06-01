import { ApiProperty, PartialType } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class CreateProductDto {
  @ApiProperty({ example: "Mobile Legends" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: "MLBB" })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  vendorId: string;

  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  categoryId: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
