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
      summary: "Create a new purchase from booking - Asynchronous Processing",
      description: `Creates a new purchase record based on a booking with asynchronous processing using job queues.

## Processing Stages
- **PENDING**: Initial creation, queued for processing
- **BLOCKCHAIN_VERIFYING**: Waiting for blockchain confirmations (12+ blocks)
- **BLOCKCHAIN_VERIFIED**: Transaction confirmed, proceeding to vendor
- **VENDOR_PROCESSING**: Calling vendor APIs
- **COMPLETED**: Purchase successfully processed
- **FAILED**: Processing failed at any stage

## Monitoring
- Use GET /purchases/ref/{refId}/status for detailed progress
- Use GET /purchases/queue/stats for queue statistics`,
    }),
    ApiResponse({
      status: 201,
      description:
        "Purchase created successfully and queued for asynchronous processing. Returns full purchase object with PENDING status.",
      schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            example: "01K13FRYDJ47QZASHAFGAAC0E4",
            description: "Purchase ID (ULID)",
          },
          refId: {
            type: "string",
            example: "unique-ref-123",
            description: "Reference ID for tracking",
          },
          status: {
            type: "string",
            example: "PENDING",
            description: "Initial status, will be processed asynchronously",
          },
          bookingId: {
            type: "string",
            example: "01K13FRYDJ47QZASHAFGAAC0E4",
            description: "Associated booking ID",
          },
          walletAddress: {
            type: "string",
            example: "0x742d35Cc6634C0532925a3b8D4d8E2",
            description: "Wallet address",
          },
          transactionHash: {
            type: "string",
            example: "0x1234567890abcdef...",
            description: "Blockchain transaction hash",
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Creation timestamp",
          },
        },
        description: "Full purchase object with initial PENDING status",
      },
    }),
    ApiResponse({
      status: 400,
      description: "Bad request - validation errors or business logic errors",
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
    }),
    ApiResponse({
      status: 404,
      description:
        "Resource not found - booking, token, network, or contract not found",
    }),
    ApiResponse({
      status: 409,
      description: "Conflict - duplicate reference ID",
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

export function ApiGetPurchaseStatusByRefId() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({
      summary: "Get purchase status by reference ID",
      description: `Retrieves detailed status information for a purchase using its reference ID.
      
## Response Details
Returns comprehensive status information including:
- Reference ID status and associated purchase
- Job queue progress for all processing stages
- Detailed job information with timestamps and progress

## Job Types Tracked
- **purchase**: Initial purchase processing job
- **blockchain**: Blockchain verification job (12+ confirmations)
- **vendor**: Vendor API calls job

## Job Status Fields
- **id**: Job ID in the queue
- **progress**: Progress percentage (0-100)
- **processedOn**: When job processing started
- **finishedOn**: When job completed (success or failure)
- **failedReason**: Error message if job failed

This endpoint is essential for monitoring asynchronous purchase processing.`,
    }),
    ApiParam({
      name: "refId",
      description: "Reference ID used during purchase creation",
      example: "unique-ref-123",
    }),
    ApiResponse({
      status: 200,
      description: "Returns detailed status information for the reference ID",
      schema: {
        type: "object",
        properties: {
          refId: {
            type: "string",
            example: "unique-ref-123",
            description: "The reference ID",
          },
          referenceStatus: {
            type: "string",
            example: "COMPLETED",
            description:
              "Status of the reference ID (PENDING, COMPLETED, FAILED, not_found)",
          },
          purchase: {
            type: "object",
            description: "Purchase object if exists, null otherwise",
            nullable: true,
          },
          jobs: {
            type: "object",
            properties: {
              purchase: {
                type: "object",
                nullable: true,
                properties: {
                  id: { type: "string", description: "Job ID" },
                  progress: { type: "number", description: "Progress 0-100" },
                  processedOn: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  finishedOn: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  failedReason: { type: "string", nullable: true },
                },
              },
              blockchain: {
                type: "object",
                nullable: true,
                properties: {
                  id: { type: "string", description: "Job ID" },
                  progress: { type: "number", description: "Progress 0-100" },
                  processedOn: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  finishedOn: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  failedReason: { type: "string", nullable: true },
                },
              },
              vendor: {
                type: "object",
                nullable: true,
                properties: {
                  id: { type: "string", description: "Job ID" },
                  progress: { type: "number", description: "Progress 0-100" },
                  processedOn: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  finishedOn: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  failedReason: { type: "string", nullable: true },
                },
              },
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: "Reference ID not found",
    }),
  );
}

export function ApiGetQueueStats() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({
      summary: "Get job queue statistics",
      description: `Retrieves comprehensive statistics for all job queues used in purchase processing.
      
## Queue Information
Returns statistics for three main queues:
- **purchase-processing**: Initial purchase validation and setup
- **blockchain-verification**: Blockchain transaction verification
- **vendor-api-calls**: External vendor API interactions

## Statistics Included
- **waiting**: Jobs waiting to be processed
- **active**: Jobs currently being processed
- **completed**: Successfully completed jobs
- **failed**: Failed jobs
- **delayed**: Jobs scheduled for future processing
- **paused**: Jobs in paused queues

This endpoint is useful for monitoring system load and queue health.`,
    }),
    ApiResponse({
      status: 200,
      description: "Returns statistics for all job queues",
      schema: {
        type: "object",
        properties: {
          "purchase-processing": {
            type: "object",
            properties: {
              waiting: {
                type: "number",
                description: "Jobs waiting to be processed",
              },
              active: {
                type: "number",
                description: "Jobs currently being processed",
              },
              completed: {
                type: "number",
                description: "Successfully completed jobs",
              },
              failed: { type: "number", description: "Failed jobs" },
              delayed: {
                type: "number",
                description: "Jobs scheduled for future",
              },
              paused: { type: "number", description: "Jobs in paused queue" },
            },
          },
          "blockchain-verification": {
            type: "object",
            properties: {
              waiting: { type: "number" },
              active: { type: "number" },
              completed: { type: "number" },
              failed: { type: "number" },
              delayed: { type: "number" },
              paused: { type: "number" },
            },
          },
          "vendor-api-calls": {
            type: "object",
            properties: {
              waiting: { type: "number" },
              active: { type: "number" },
              completed: { type: "number" },
              failed: { type: "number" },
              delayed: { type: "number" },
              paused: { type: "number" },
            },
          },
        },
      },
    }),
  );
}
