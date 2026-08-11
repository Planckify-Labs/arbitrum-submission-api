import { ApiProperty } from "@nestjs/swagger";

export class RegionResponseDto {
  @ApiProperty({ example: "01H1G5V..." })
  id: string;

  @ApiProperty({ example: "ID" })
  code: string;

  @ApiProperty({ example: "Indonesia" })
  name: string;

  @ApiProperty({ example: "IDR" })
  currencyCode: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: false })
  hasKYCRequirement: boolean;

  @ApiProperty({ example: 11 })
  taxRate: number;

  @ApiProperty({ example: "support-id@takumipay.xyz", required: false })
  supportEmail?: string;

  @ApiProperty({ example: "+62123456789", required: false })
  supportPhone?: string;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2024-03-14T12:00:00.000Z" })
  updatedAt: Date;
}
