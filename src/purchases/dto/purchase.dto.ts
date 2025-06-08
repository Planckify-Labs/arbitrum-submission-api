import { ApiProperty } from "@nestjs/swagger";
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import { PurchaseStatus } from "@generated/prisma";

interface CustomerInfo {
  gameId: string;
  serverID: string;
  [key: string]: string;
}

interface VendorResponse {
  success: boolean;
  message: string;
  transactionId: string;
  [key: string]: unknown;
}

export class CreatePurchaseDto {
  @ApiProperty({
    description: "Transaction ID associated with the purchase",
    example: "01H1G5V...",
  })
  @IsString()
  @IsNotEmpty()
  transactionId: string;

  @ApiProperty({
    description: "Product variant ID being purchased",
    example: "01H1G5V...",
  })
  @IsString()
  @IsNotEmpty()
  productVariantId: string;

  @ApiProperty({
    description: "Customer information for the purchase",
    example: { gameId: "12345678", serverID: "9999" },
  })
  @IsObject()
  @IsNotEmpty()
  customerInfo: CustomerInfo;
}

export class UpdatePurchaseDto {
  @ApiProperty({
    description: "Status of the purchase",
    enum: PurchaseStatus,
    example: PurchaseStatus.COMPLETED,
  })
  @IsEnum(PurchaseStatus)
  @IsOptional()
  status?: PurchaseStatus;

  @ApiProperty({
    description: "Vendor's response data",
    example: {
      success: true,
      message: "Top up successful",
      transactionId: "VC123456789",
    },
  })
  @IsObject()
  @IsOptional()
  vendorResponse?: VendorResponse;

  @ApiProperty({
    description: "Vendor's reference ID",
    example: "VC123456789",
  })
  @IsString()
  @IsOptional()
  vendorRefId?: string;
}

export class PurchaseResponseDto {
  @ApiProperty({
    description: "Purchase ID",
    example: "01H1G5V...",
  })
  id: string;

  @ApiProperty({
    description: "Transaction ID associated with the purchase",
    example: "01H1G5V...",
  })
  transactionId: string;

  @ApiProperty({
    description: "Product ID being purchased",
    example: "01H1G5V...",
  })
  productId: string;

  @ApiProperty({
    description: "Product price ID for the purchase",
    example: "01H1G5V...",
  })
  productPriceId: string;

  @ApiProperty({
    description: "Status of the purchase",
    enum: PurchaseStatus,
    example: PurchaseStatus.COMPLETED,
  })
  status: PurchaseStatus;

  @ApiProperty({
    description: "Customer information for the purchase",
    example: { gameId: "12345678", serverID: "9999" },
  })
  customerInfo: CustomerInfo;

  @ApiProperty({
    description: "Vendor's response data",
    example: {
      success: true,
      message: "Top up successful",
      transactionId: "VC123456789",
    },
  })
  vendorResponse?: VendorResponse;

  @ApiProperty({
    description: "Vendor's reference ID",
    example: "VC123456789",
  })
  vendorRefId?: string;

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
