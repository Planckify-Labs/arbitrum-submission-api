import { applyDecorators } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { PurchaseStatus } from "@generated/prisma";

export function ApiCreatePurchase() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Create a new purchase from booking",
      description: `Creates a new purchase record based on a booking.
      
Response Format: "purchaseId#bookingId#productVariantId"

IMPORTANT: The order and format of these IDs must be preserved exactly as returned.
This string is used to maintain data integrity between on-chain and off-chain systems.

Response Components:
1. purchaseId: Unique identifier for the newly created purchase record
2. bookingId: Reference to the original booking that initiated this purchase
3. productVariantId: Identifier of the specific product variant being purchased

Example: "01HN8V...#01HN8T...#01HN8R..."

Note: Do not modify or reorder these IDs as they are used to verify and track the purchase onchain`,
    }),
    ApiResponse({
      status: 201,
      description:
        "Purchase created successfully. Returns a string containing purchaseId, bookingId, and productVariantId in a specific format.",
      schema: {
        type: "string",
        example: "01HN8V...#01HN8T...#01HN8R...",
        description: "Format: purchaseId#bookingId#productVariantId",
      },
    }),
    ApiResponse({
      status: 400,
      description:
        "Invalid input data, booking expired, wallet address mismatch, or network/smart contract validation failed",
    }),
    ApiResponse({
      status: 404,
      description: "Booking not found or token not found",
    }),
  );
}

export function ApiGetPurchases() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get all purchases",
      description: "Retrieves a paginated list of all purchases",
    }),
    ApiQuery({
      name: "cursor",
      required: false,
      description:
        "Cursor for pagination (ID of the last item in previous page)",
    }),
    ApiQuery({
      name: "take",
      required: false,
      description: "Number of items to retrieve (default: 10)",
    }),
    ApiResponse({
      status: 200,
      description: "Returns a list of purchases",
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
      description: "Returns the purchase details",
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
    ApiQuery({
      name: "cursor",
      required: false,
      description: "Cursor for pagination",
    }),
    ApiQuery({
      name: "take",
      required: false,
      description: "Number of items to retrieve (default: 10)",
    }),
    ApiResponse({
      status: 200,
      description: "Returns filtered list of purchases",
    }),
  );
}

export function ApiUpdatePurchaseStatus() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Update purchase status",
      description: "Updates the status of a purchase",
    }),
    ApiParam({
      name: "id",
      description: "Purchase ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Purchase status updated successfully",
    }),
    ApiResponse({
      status: 404,
      description: "Purchase not found",
    }),
    ApiResponse({
      status: 400,
      description: "Invalid input data",
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
      description: "Returns the purchase status details",
    }),
    ApiResponse({
      status: 404,
      description: "Purchase not found",
    }),
  );
}

export function ApiGetUserPurchases() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get user purchases",
      description: "Retrieves all purchases for a specific user",
    }),
    ApiParam({
      name: "userId",
      description: "User ID",
      example: "01H1G5V...",
    }),
    ApiQuery({
      name: "cursor",
      required: false,
      description: "Cursor for pagination",
    }),
    ApiQuery({
      name: "take",
      required: false,
      description: "Number of items to retrieve (default: 10)",
    }),
    ApiResponse({
      status: 200,
      description: "Returns purchases for the specified user",
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
      description: "Retrieves all purchases made with a specific token",
    }),
    ApiParam({
      name: "tokenId",
      description: "Token ID",
      example: "01H1G5V...",
    }),
    ApiQuery({
      name: "cursor",
      required: false,
      description: "Cursor for pagination",
    }),
    ApiQuery({
      name: "take",
      required: false,
      description: "Number of items to retrieve (default: 10)",
    }),
    ApiResponse({
      status: 200,
      description: "Returns purchases for the specified token",
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
      description: "Retrieves all purchases made on a specific blockchain",
    }),
    ApiParam({
      name: "blockchainId",
      description: "Blockchain ID",
      example: "01H1G5V...",
    }),
    ApiQuery({
      name: "cursor",
      required: false,
      description: "Cursor for pagination",
    }),
    ApiQuery({
      name: "take",
      required: false,
      description: "Number of items to retrieve (default: 10)",
    }),
    ApiResponse({
      status: 200,
      description: "Returns purchases for the specified blockchain",
    }),
    ApiResponse({
      status: 404,
      description: "Blockchain not found",
    }),
  );
}
