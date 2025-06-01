import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { PurchaseStatus } from "@generated/prisma";

export class SearchPurchaseDto {
  @ApiProperty({
    description: "User ID to filter purchases",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiProperty({
    description: "Transaction ID to filter purchases",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  transactionId?: string;

  @ApiProperty({
    description: "Product ID to filter purchases",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiProperty({
    description: "Vendor ID to filter purchases",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  vendorId?: string;

  @ApiProperty({
    description: "Token ID to filter purchases",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  tokenId?: string;

  @ApiProperty({
    description: "Blockchain ID to filter purchases",
    example: "01H1G5V...",
    required: false,
  })
  @IsString()
  @IsOptional()
  blockchainId?: string;

  @ApiProperty({
    description: "Purchase status to filter by",
    enum: PurchaseStatus,
    required: false,
  })
  @IsEnum(PurchaseStatus)
  @IsOptional()
  status?: PurchaseStatus;
}
