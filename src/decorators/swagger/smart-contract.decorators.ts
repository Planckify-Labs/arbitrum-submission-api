import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { SmartContractResponseDto } from "../../smart-contracts/dto/smart-contract-response.dto";

const notFoundResponse = {
  status: 404,
  description: "Smart contract not found",
};

export function ApiGetSmartContracts() {
  return applyDecorators(
    ApiOperation({ summary: "Get all smart contracts" }),
    ApiResponse({
      status: 200,
      description: "Returns a list of smart contracts",
      type: SmartContractResponseDto,
      isArray: true,
    }),
  );
}

export function ApiSearchSmartContracts() {
  return applyDecorators(
    ApiOperation({
      summary: "Search smart contracts",
      description: `Search smart contracts with various filters:
      - Contract filters: name, address, ABI ID, active status
      - Blockchain filters: name, chain ID, EVM compatibility
      Results are ordered by blockchain name and then contract name.`,
    }),
    ApiResponse({
      status: 200,
      description: "Returns filtered list of smart contracts",
      type: SmartContractResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetSmartContract() {
  return applyDecorators(
    ApiOperation({ summary: "Get smart contract by ID" }),
    ApiParam({
      name: "id",
      description: "Smart Contract ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Returns a smart contract",
      type: SmartContractResponseDto,
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiCreateSmartContract() {
  return applyDecorators(
    ApiOperation({ summary: "Create a new smart contract" }),
    ApiResponse({
      status: 201,
      description: "Smart contract created successfully",
      type: SmartContractResponseDto,
    }),
    ApiResponse({
      status: 400,
      description: "Invalid input data",
    }),
  );
}

export function ApiUpdateSmartContract() {
  return applyDecorators(
    ApiOperation({ summary: "Update smart contract" }),
    ApiParam({
      name: "id",
      description: "Smart Contract ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Smart contract updated successfully",
      type: SmartContractResponseDto,
    }),
    ApiResponse(notFoundResponse),
    ApiResponse({
      status: 400,
      description: "Invalid input data",
    }),
  );
}

export function ApiDeleteSmartContract() {
  return applyDecorators(
    ApiOperation({ summary: "Delete smart contract" }),
    ApiParam({
      name: "id",
      description: "Smart Contract ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 204,
      description: "Smart contract deleted successfully",
    }),
    ApiResponse(notFoundResponse),
  );
}
