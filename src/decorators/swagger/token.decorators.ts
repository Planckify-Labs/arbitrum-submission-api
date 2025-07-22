import { applyDecorators } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiHeader,
} from "@nestjs/swagger";
import { TokenResponseDto } from "../../tokens/dto/token-response.dto";

export function ApiGetTokens() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Get all tokens" }),
    ApiResponse({
      status: 200,
      description: "Returns all tokens",
      type: TokenResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetToken() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Get token by ID" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({
      status: 200,
      description: "Returns the token",
      type: TokenResponseDto,
    }),
    ApiResponse({ status: 404, description: "Token not found" }),
  );
}

export function ApiCreateToken() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Create new token" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiResponse({
      status: 201,
      description: "Token created successfully",
      type: TokenResponseDto,
    }),
    ApiResponse({ status: 400, description: "Invalid input" }),
  );
}

export function ApiUpdateToken() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Update token" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({
      status: 200,
      description: "Token updated successfully",
      type: TokenResponseDto,
    }),
    ApiResponse({ status: 404, description: "Token not found" }),
    ApiResponse({ status: 400, description: "Invalid input" }),
  );
}

export function ApiDeleteToken() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Delete token" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({ status: 204, description: "Token deleted successfully" }),
    ApiResponse({ status: 404, description: "Token not found" }),
  );
}

export function ApiSearchTokens() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Search tokens with filters" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiQuery({ name: "symbol", type: String, required: false }),
    ApiQuery({ name: "name", type: String, required: false }),
    ApiQuery({ name: "blockchainId", type: String, required: false }),
    ApiQuery({ name: "contractAddress", type: String, required: false }),
    ApiQuery({ name: "isStablecoin", type: Boolean, required: false }),
    ApiQuery({ name: "isActive", type: Boolean, required: false }),
    ApiQuery({ name: "isNativeCurrency", type: Boolean, required: false }),
    ApiResponse({
      status: 200,
      description: "Returns filtered tokens",
      type: TokenResponseDto,
      isArray: true,
    }),
  );
}
