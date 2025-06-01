import { ApiProperty } from "@nestjs/swagger";

export class ProductResponseDto {
  @ApiProperty({ example: "01H1G5V..." })
  id: string;

  @ApiProperty({ example: "Product Name" })
  name: string;

  @ApiProperty({ example: "Product Description", required: false })
  description?: string;

  @ApiProperty({ example: "https://example.com/image.jpg", required: false })
  imageUrl?: string;

  @ApiProperty({ example: "01H1G5V..." })
  vendorId: string;

  @ApiProperty({ example: "PROD001" })
  code: string;

  @ApiProperty({ example: "01H1G5V..." })
  categoryId: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;
}
