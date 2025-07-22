import { applyDecorators } from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from "@nestjs/swagger";
import { BlockchainResponseDto } from "../../blockchains/dto/blockchain-response.dto";

const notFoundResponse = {
  status: 404,
  description: "Blockchain not found",
};

export function ApiGetBlockchains() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Get all blockchains with their native tokens" }),
    ApiResponse({
      status: 200,
      description: "Returns a list of blockchains with their native tokens",
      type: BlockchainResponseDto,
      isArray: true,
    }),
  );
}

export function ApiSearchBlockchains() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({
      summary: "Search blockchains",
      description:
        "Search blockchains with filters for name, chainId, isEVM, and isActive",
    }),
    ApiResponse({
      status: 200,
      description: "Returns filtered list of blockchains",
      type: BlockchainResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetBlockchain() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Get blockchain by ID with its native token" }),
    ApiParam({
      name: "id",
      description: "Blockchain ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Returns a blockchain with its native token",
      type: BlockchainResponseDto,
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiCreateBlockchain() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Create a new blockchain" }),
    ApiResponse({
      status: 201,
      description: "Blockchain created successfully",
      type: BlockchainResponseDto,
    }),
    ApiResponse({
      status: 400,
      description: "Invalid input data",
    }),
  );
}

export function ApiUpdateBlockchain() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Update blockchain" }),
    ApiParam({
      name: "id",
      description: "Blockchain ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Blockchain updated successfully",
      type: BlockchainResponseDto,
    }),
    ApiResponse(notFoundResponse),
    ApiResponse({
      status: 400,
      description: "Invalid input data",
    }),
  );
}

export function ApiDeleteBlockchain() {
  return applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Delete blockchain" }),
    ApiParam({
      name: "id",
      description: "Blockchain ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 204,
      description: "Blockchain deleted successfully",
    }),
    ApiResponse(notFoundResponse),
  );
}
