import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam, ApiQuery } from "@nestjs/swagger";
import { TransactionResponseDto } from "../../transactions/dto/transaction-response.dto";
import { TransactionStatus, TransactionType } from "@generated/prisma";

export function ApiGetTransactions() {
  return applyDecorators(
    ApiOperation({ summary: "Get all transactions" }),
    ApiResponse({
      status: 200,
      description: "Returns a list of transactions",
      type: TransactionResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetTransaction() {
  return applyDecorators(
    ApiOperation({ summary: "Get transaction by ID" }),
    ApiParam({ name: "id", description: "Transaction ID" }),
    ApiResponse({
      status: 200,
      description: "Returns a transaction",
      type: TransactionResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "Transaction not found",
    }),
  );
}

export function ApiCreateTransaction() {
  return applyDecorators(
    ApiOperation({ summary: "Create a new transaction" }),
    ApiResponse({
      status: 201,
      description: "Transaction created successfully",
      type: TransactionResponseDto,
    }),
  );
}

export function ApiUpdateTransactionStatus() {
  return applyDecorators(
    ApiOperation({ summary: "Update transaction status" }),
    ApiParam({ name: "id", description: "Transaction ID" }),
    ApiResponse({
      status: 200,
      description: "Transaction status updated successfully",
      type: TransactionResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "Transaction not found",
    }),
  );
}

export function ApiGetUserTransactions() {
  return applyDecorators(
    ApiOperation({ summary: "Get user's transactions" }),
    ApiParam({ name: "userId", description: "User ID" }),
    ApiResponse({
      status: 200,
      description: "Returns user's transactions",
      type: TransactionResponseDto,
      isArray: true,
    }),
    ApiResponse({
      status: 404,
      description: "User not found",
    }),
  );
}

export function ApiSearchTransactions() {
  return applyDecorators(
    ApiOperation({ summary: "Search transactions with filters" }),
    ApiQuery({ name: "type", enum: TransactionType, required: false }),
    ApiQuery({ name: "status", enum: TransactionStatus, required: false }),
    ApiQuery({ name: "userId", type: String, required: false }),
    ApiQuery({ name: "tokenId", type: String, required: false }),
    ApiQuery({ name: "fromAddress", type: String, required: false }),
    ApiQuery({ name: "toAddress", type: String, required: false }),
    ApiQuery({ name: "startDate", type: String, required: false }),
    ApiQuery({ name: "endDate", type: String, required: false }),
    ApiResponse({
      status: 200,
      description: "Returns filtered transactions",
      type: TransactionResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetBlockchainTransactions() {
  return applyDecorators(
    ApiOperation({ summary: "Get blockchain's transactions" }),
    ApiParam({ name: "blockchainId", description: "Blockchain ID" }),
    ApiResponse({
      status: 200,
      description: "Returns blockchain's transactions",
      type: TransactionResponseDto,
      isArray: true,
    }),
    ApiResponse({
      status: 404,
      description: "Blockchain not found",
    }),
  );
}

export function ApiGetTokenTransactions() {
  return applyDecorators(
    ApiOperation({ summary: "Get token's transactions" }),
    ApiParam({ name: "tokenId", description: "Token ID" }),
    ApiResponse({
      status: 200,
      description: "Returns token's transactions",
      type: TransactionResponseDto,
      isArray: true,
    }),
    ApiResponse({
      status: 404,
      description: "Token not found",
    }),
  );
}
