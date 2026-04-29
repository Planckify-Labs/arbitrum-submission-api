import { applyDecorators } from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
  ApiHeader,
  ApiParam,
} from "@nestjs/swagger";
import {
  CreateExchangeRateDto,
  ExchangeRateResponseDto,
  QueryExchangeRateDto,
  GetLatestExchangeRateDto,
} from "../../exchange-rate/dto/exchange-rate.dto";

export const ApiCreateExchangeRate = () =>
  applyDecorators(
    ApiHeader({
      name: "Authorization",
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Create a new exchange rate" }),
    ApiBody({ type: CreateExchangeRateDto }),
    ApiResponse({
      status: 201,
      description: "Exchange rate created successfully",
      type: ExchangeRateResponseDto,
    }),
  );

export const ApiGetLatestExchangeRate = () =>
  applyDecorators(
    ApiHeader({
      name: "X-API-Key",
      required: true,
      description: "API Key for public access",
      example: "your-api-key-here",
    }),
    ApiOperation({
      summary: "Get latest exchange rate",
      description:
        "Returns the most recent exchange rate. Optionally filter by fromCurrency and toCurrency.",
    }),
    ApiQuery({
      name: "fromCurrency",
      required: false,
      type: String,
      description: "Currency to convert from",
    }),
    ApiQuery({
      name: "toCurrency",
      required: false,
      type: String,
      description: "Currency to convert to",
    }),
    ApiResponse({
      status: 200,
      description: "Latest exchange rate retrieved successfully",
      type: ExchangeRateResponseDto,
    }),
    ApiResponse({
      status: 401,
      description: "Invalid or missing API key",
    }),
  );

export const ApiGetAllExchangeRates = () =>
  applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({
      summary: "Get all exchange rates with cursor-based pagination",
    }),
    ApiQuery({ type: QueryExchangeRateDto }),
    ApiResponse({
      status: 200,
      description: "Exchange rates retrieved successfully",
      type: ExchangeRateResponseDto,
      isArray: true,
    }),
  );

export const ApiGetAverageExchangeRate = () =>
  applyDecorators(
    ApiHeader({
      name: "Authorization",
      required: true,
      description: "JWT token",
      example: "Bearer <token>",
    }),
    ApiOperation({ summary: "Get average exchange rate" }),
    ApiQuery({ type: QueryExchangeRateDto }),
    ApiResponse({
      status: 200,
      description: "Average exchange rate retrieved successfully",
      type: Number,
    }),
  );

export const ApiGetExchangeRatePublic = () =>
  applyDecorators(
    ApiHeader({
      name: "X-API-Key",
      required: true,
      description: "API Key for public access",
      example: "your-api-key-here",
    }),
    ApiOperation({
      summary: "Get exchange rate by ID (Public API)",
      description:
        "Retrieves detailed information about a specific exchange rate",
    }),
    ApiParam({
      name: "id",
      description: "Exchange Rate ID",
      example: "123",
      required: true,
      type: "number",
    }),
    ApiResponse({
      status: 200,
      description: "Returns the exchange rate with the specified ID",
      type: ExchangeRateResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "Exchange rate not found",
    }),
    ApiResponse({
      status: 401,
      description: "Invalid or missing API key",
    }),
  );
