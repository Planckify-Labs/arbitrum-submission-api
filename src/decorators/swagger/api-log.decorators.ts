import { applyDecorators } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { ApiLogResponseDto } from "../../api-logs/dto/api-log.dto";

export function ApiGetLogs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get all API logs",
      description: "Retrieves a list of all API request logs",
    }),
    ApiResponse({
      status: 200,
      description: "List of API logs",
      type: [ApiLogResponseDto],
    }),
  );
}

export function ApiSearchLogs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Search API logs",
      description: "Search API logs with various filters",
    }),
    ApiQuery({
      name: "requestId",
      required: false,
      description: "Filter by request ID",
    }),
    ApiQuery({
      name: "userId",
      required: false,
      description: "Filter by user ID",
    }),
    ApiQuery({
      name: "purchaseId",
      required: false,
      description: "Filter by purchase ID",
    }),
    ApiQuery({
      name: "service",
      required: false,
      description: "Filter by service name",
    }),
    ApiQuery({
      name: "endpoint",
      required: false,
      description: "Filter by endpoint path",
    }),
    ApiQuery({
      name: "method",
      required: false,
      description: "Filter by HTTP method",
    }),
    ApiQuery({
      name: "success",
      required: false,
      description: "Filter by success status",
      type: Boolean,
    }),
    ApiResponse({
      status: 200,
      description: "List of filtered API logs",
      type: [ApiLogResponseDto],
    }),
  );
}

export function ApiGetLogByRequestId() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get API log by request ID",
      description: "Retrieves a specific API log by its request ID",
    }),
    ApiParam({
      name: "requestId",
      description: "Request ID",
      example: "req_123456789",
    }),
    ApiResponse({
      status: 200,
      description: "API log details",
      type: ApiLogResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "API log not found",
    }),
  );
}

export function ApiGetUserLogs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get user API logs",
      description: "Retrieves all API logs for a specific user",
    }),
    ApiParam({
      name: "userId",
      description: "User ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "List of user's API logs",
      type: [ApiLogResponseDto],
    }),
    ApiResponse({
      status: 404,
      description: "User not found",
    }),
  );
}

export function ApiGetPurchaseLogs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: "Get purchase API logs",
      description: "Retrieves all API logs for a specific purchase",
    }),
    ApiParam({
      name: "purchaseId",
      description: "Purchase ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "List of purchase API logs",
      type: [ApiLogResponseDto],
    }),
    ApiResponse({
      status: 404,
      description: "Purchase not found",
    }),
  );
}
