import { applyDecorators } from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from "@nestjs/swagger";
import { UserResponseDto } from "../../users/dto/user-response.dto";
import { UserTransactionResponseDto } from "../../users/dto/transaction-response.dto";

export function ApiGetUsers() {
  return applyDecorators(
    ApiOperation({ summary: "Get all users" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiResponse({
      status: 200,
      description: "Returns a list of users",
      type: UserResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetUser() {
  return applyDecorators(
    ApiOperation({ summary: "Get user by ID" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiParam({ name: "id", description: "User ID" }),
    ApiResponse({
      status: 200,
      description: "Returns a user",
      type: UserResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "User not found",
    }),
  );
}

export function ApiCreateUser() {
  return applyDecorators(
    ApiOperation({ summary: "Create a new user" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiResponse({
      status: 201,
      description: "User created successfully",
      type: UserResponseDto,
    }),
  );
}

export function ApiUpdateUser() {
  return applyDecorators(
    ApiOperation({ summary: "Update user" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiParam({ name: "id", description: "User ID" }),
    ApiResponse({
      status: 200,
      description: "User updated successfully",
      type: UserResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "User not found",
    }),
  );
}

export function ApiDeleteUser() {
  return applyDecorators(
    ApiOperation({ summary: "Delete user" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiParam({ name: "id", description: "User ID" }),
    ApiResponse({
      status: 204,
      description: "User deleted successfully",
    }),
    ApiResponse({
      status: 404,
      description: "User not found",
    }),
  );
}

export function ApiGetUserTransactions() {
  return applyDecorators(
    ApiOperation({ summary: "Get user's transaction history" }),
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiParam({ name: "id", description: "User ID" }),
    ApiResponse({
      status: 200,
      description: "Returns user's transactions",
      type: UserTransactionResponseDto,
      isArray: true,
    }),
    ApiResponse({
      status: 404,
      description: "User not found",
    }),
  );
}
