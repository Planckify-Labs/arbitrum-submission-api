import { applyDecorators } from "@nestjs/common";
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { PurchaseStatus } from "@generated/prisma";

export function ApiCreatePurchase() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({
      summary: "Create a new purchase from booking",
      description: `Creates a new purchase record based on a booking.
      
Response Format: "purchaseId#bookingId#productVariantId"

IMPORTANT: This format is optimized for smart contract compatibility using Solidity string storage.
Full ULIDs are used for maximum readability and data integrity.
The order and format must be preserved exactly as returned.

Response Components:
1. purchaseId: Full ULID of the newly created purchase record
2. bookingId: Full ULID of the original booking that initiated this purchase
3. productVariantId: Full ULID of the specific product variant being purchased

Example: "01K13FRYDJ47QZASHAFGAAC0E4#01K13FRYDJ47QZASHAFGAAC0E4#01K13FRYDJ47QZASHAFGAAC0E4"

Note: Do not modify or reorder these IDs as they are used to verify and track the purchase onchain

## Error Response Format
Errors are returned as packed strings: "ERROR#{statusCode}#{errorCode}#{errorDetail}"

### Status Codes:
- 400: BAD_REQ (Bad Request)
- 404: NOT_FOUND (Resource Not Found)
- 409: CONFLICT (Duplicate Reference ID)
- 429: RATE_LMT (Rate Limit Exceeded)
- 500+: SRV_ERR (Server Error)

### Error Details:
- BK_NOT_FND: Booking with ID not found
- BK_EXPIRED: Booking has expired
- BK_NOT_PEND: Booking status is not pending
- WALLET_MISM: Wallet address mismatch
- NET_NOT_FND: Network ID not found
- NET_INACTIVE: Network is not active
- CTR_NOT_FND: Smart contract not found
- CTR_INACTIVE: Smart contract is not active
- TKN_NOT_FND: Token not found on network
- CUST_INFO_REQ: Customer information required
- DUP_REF_ID: Reference ID already processed
- VENDOR_ERR: External vendor API error
- VALID_ERR: Input validation failed
- FIELD_REQ: Required field missing
- GEN_ERR: General/unknown error

Example error: "ERROR#400#BAD_REQ#BK_EXPIRED"`,
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
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

export function ApiCreatePurchasePublic() {
  return applyDecorators(
    ApiHeader({
      name: "X-API-Key",
      required: true,
      description: "API Key for public access",
      example: "your-api-key-here",
    }),
    ApiOperation({
      summary: "Create a new purchase from booking (Public API)",
      description: `Creates a new purchase record based on a booking.

Response Format: "purchaseId#bookingId#productVariantId"

IMPORTANT: This format is optimized for smart contract compatibility using Solidity string storage.
Full ULIDs are used for maximum readability and data integrity.
The order and format must be preserved exactly as returned.

Response Components:
1. purchaseId: Full ULID of the newly created purchase record
2. bookingId: Full ULID of the original booking that initiated this purchase
3. productVariantId: Full ULID of the specific product variant being purchased

Example: "01K13FRYDJ47QZASHAFGAAC0E4#01K13FRYDJ47QZASHAFGAAC0E4#01K13FRYDJ47QZASHAFGAAC0E4"

Note: Do not modify or reorder these IDs as they are used to verify and track the purchase onchain

## Error Response Format
Errors are returned as packed strings: "ERROR#{statusCode}#{errorCode}#{errorDetail}"

### Status Codes:
- 400: BAD_REQ (Bad Request)
- 404: NOT_FOUND (Resource Not Found)
- 409: CONFLICT (Duplicate Reference ID)
- 429: RATE_LMT (Rate Limit Exceeded)
- 500+: SRV_ERR (Server Error)

### Error Details:
- BK_NOT_FND: Booking with ID not found
- BK_EXPIRED: Booking has expired
- BK_NOT_PEND: Booking status is not pending
- WALLET_MISM: Wallet address mismatch
- NET_NOT_FND: Network ID not found
- NET_INACTIVE: Network is not active
- CTR_NOT_FND: Smart contract not found
- CTR_INACTIVE: Smart contract is not active
- TKN_NOT_FND: Token not found on network
- CUST_INFO_REQ: Customer information required
- DUP_REF_ID: Reference ID already processed
- VENDOR_ERR: External vendor API error
- VALID_ERR: Input validation failed
- FIELD_REQ: Required field missing
- GEN_ERR: General/unknown error

Example error: "ERROR#400#BAD_REQ#BK_EXPIRED"`,
    }),
    ApiResponse({
      status: 201,
      description:
        "Purchase created successfully. Returns packed string format for smart contract compatibility.",
      schema: {
        type: "string",
        example:
          "01K13FRYDJ47QZASHAFGAAC0E4#01K13FRYDJ47QZASHAFGAAC0E4#01K13FRYDJ47QZASHAFGAAC0E4",
        description:
          "Packed string containing full purchase, booking, and product variant ULIDs",
      },
    }),
    ApiResponse({
      status: 400,
      description: "Bad request - validation errors or business logic errors",
      schema: {
        type: "string",
        example: "ERROR#400#BAD_REQ#BK_EXPIRED",
        description: "Packed error string format",
      },
    }),
    ApiResponse({
      status: 401,
      description: "Invalid or missing API key",
    }),
    ApiResponse({
      status: 404,
      description: "Resource not found",
      schema: {
        type: "string",
        example: "ERROR#404#NOT_FOUND#BK_NOT_FND",
        description: "Packed error string format",
      },
    }),
    ApiResponse({
      status: 409,
      description: "Conflict - duplicate reference ID",
      schema: {
        type: "string",
        example: "ERROR#409#CONFLICT#DUP_REF_ID",
        description: "Packed error string format",
      },
    }),
  );
}
