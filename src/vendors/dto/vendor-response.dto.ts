import { ApiProperty } from "@nestjs/swagger";

export class VendorResponseDto {
  @ApiProperty({ example: "01H1G5V..." })
  id: string;

  @ApiProperty({ example: "Vendor Name" })
  name: string;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;
}
