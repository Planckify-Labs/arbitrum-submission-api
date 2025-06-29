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
    description: "Wallet address of the user",
    example: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({
    description: "Booking ID associated with the purchase",
    example: "01H1G5V...",
  })
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @ApiProperty({
    description: "Smart contract address that made the request",
    example: "0x1234567890abcdef1234567890abcdef12345678",
  })
  @IsString()
  @IsNotEmpty()
  contractAddress: string;

  @ApiProperty({
    description: "Network ID from the database",
    example: "01JX2FJZ7Y37Y9XXDHYP323P0X",
  })
  @IsString()
  @IsNotEmpty()
  networkId: string;

  @ApiProperty({
    description: "Customer information for the purchase",
    example: { gameId: "12345678", serverID: "9999" },
  })
  @IsObject()
  @IsOptional()
  customerInfo?: CustomerInfo;
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
