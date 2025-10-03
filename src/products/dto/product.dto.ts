import { ApiProperty, PartialType } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsOptional, IsBoolean } from "class-validator";

export class CreateProductDto {
  @ApiProperty({ example: "Mobile Legends" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: "A popular mobile MOBA game", required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: "https://example.com/image.jpg", required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  vendorId: string;

  @ApiProperty({ example: "MLBB" })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({ example: "01H1G5V..." })
  @IsNotEmpty()
  @IsString()
  categoryId: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    example: false,
    required: false,
    description: "Indicates if this product is a voucher",
  })
  @IsOptional()
  @IsBoolean()
  isVoucher?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
