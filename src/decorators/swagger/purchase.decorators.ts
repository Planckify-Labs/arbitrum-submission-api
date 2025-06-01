import { applyDecorators } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { PurchaseResponseDto } from "../../purchases/dto/purchase.dto";
import { PurchaseStatus } from "@generated/prisma";

export function ApiCreatePurchase() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Create a new purchase",
      description: "Creates a new purchase record in the system",
    }),
    ApiResponse({
      status: 201,
      description: "Purchase created successfully",
      type: PurchaseResponseDto,
    }),
    ApiResponse({
      status: 400,
      description: "Invalid input data",
    }),
    ApiResponse({
      status: 404,
      description: "Related resources not found",
    }),
  );
}

export function ApiGetPurchases() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get all purchases",
      description: "Retrieves a list of all purchases",
    }),
    ApiResponse({
      status: 200,
      description: "List of purchases",
      type: [PurchaseResponseDto],
    }),
  );
}

export function ApiGetPurchase() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get purchase by ID",
      description: "Retrieves a specific purchase by its ID",
    }),
    ApiParam({
      name: "id",
      description: "Purchase ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Purchase details",
      type: PurchaseResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "Purchase not found",
    }),
  );
}

export function ApiGetPurchaseStatus() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get purchase status",
      description: "Retrieves the current status of a purchase",
    }),
    ApiParam({
      name: "id",
      description: "Purchase ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Purchase status details",
      type: PurchaseResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "Purchase not found",
    }),
  );
}

export function ApiUpdatePurchaseStatus() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Update purchase status",
      description: "Updates the status of a specific purchase",
    }),
    ApiParam({
      name: "id",
      description: "Purchase ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Purchase status updated successfully",
      type: PurchaseResponseDto,
    }),
    ApiResponse({
      status: 400,
      description: "Invalid status update data",
    }),
    ApiResponse({
      status: 404,
      description: "Purchase not found",
    }),
  );
}

export function ApiSearchPurchases() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Search purchases",
      description: "Search purchases with various filters",
    }),
    ApiQuery({
      name: "userId",
      required: false,
      description: "Filter by user ID",
    }),
    ApiQuery({
      name: "transactionId",
      required: false,
      description: "Filter by transaction ID",
    }),
    ApiQuery({
      name: "productId",
      required: false,
      description: "Filter by product ID",
    }),
    ApiQuery({
      name: "vendorId",
      required: false,
      description: "Filter by vendor ID",
    }),
    ApiQuery({
      name: "tokenId",
      required: false,
      description: "Filter by token ID",
    }),
    ApiQuery({
      name: "blockchainId",
      required: false,
      description: "Filter by blockchain ID",
    }),
    ApiQuery({
      name: "status",
      required: false,
      description: "Filter by purchase status",
      enum: PurchaseStatus,
    }),
    ApiResponse({
      status: 200,
      description: "List of filtered purchases",
      type: [PurchaseResponseDto],
    }),
  );
}

export function ApiGetUserPurchases() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get user purchases",
      description: "Get all purchases for a specific user",
    }),
    ApiParam({
      name: "userId",
      description: "User ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "List of user's purchases",
      type: [PurchaseResponseDto],
    }),
    ApiResponse({
      status: 404,
      description: "User not found",
    }),
  );
}

export function ApiGetTokenPurchases() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get token purchases",
      description: "Get all purchases for a specific token",
    }),
    ApiParam({
      name: "tokenId",
      description: "Token ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "List of token purchases",
      type: [PurchaseResponseDto],
    }),
    ApiResponse({
      status: 404,
      description: "Token not found",
    }),
  );
}

export function ApiGetBlockchainPurchases() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get blockchain purchases",
      description: "Get all purchases for a specific blockchain",
    }),
    ApiParam({
      name: "blockchainId",
      description: "Blockchain ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "List of blockchain purchases",
      type: [PurchaseResponseDto],
    }),
    ApiResponse({
      status: 404,
      description: "Blockchain not found",
    }),
  );
}
