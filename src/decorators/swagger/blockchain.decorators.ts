import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { BlockchainResponseDto } from "../../blockchains/dto/blockchain-response.dto";

const notFoundResponse = {
  status: 404,
  description: "Blockchain not found",
};

export function ApiGetBlockchains() {
  return applyDecorators(
    ApiOperation({ summary: "Get all blockchains" }),
    ApiResponse({
      status: 200,
      description: "Returns a list of blockchains",
      type: BlockchainResponseDto,
      isArray: true,
    }),
  );
}

export function ApiSearchBlockchains() {
  return applyDecorators(
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
    ApiOperation({ summary: "Get blockchain by ID" }),
    ApiParam({
      name: "id",
      description: "Blockchain ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Returns a blockchain",
      type: BlockchainResponseDto,
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiCreateBlockchain() {
  return applyDecorators(
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
