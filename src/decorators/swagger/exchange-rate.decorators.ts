import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiBody, ApiQuery } from "@nestjs/swagger";
import {
  CreateExchangeRateDto,
  ExchangeRateResponseDto,
  QueryExchangeRateDto,
  CursorPaginatedExchangeRateResponse,
  GetLatestExchangeRateDto,
} from "../../exchange-rate/dto/exchange-rate.dto";

export const ApiCreateExchangeRate = () =>
  applyDecorators(
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
  );

export const ApiGetAllExchangeRates = () =>
  applyDecorators(
    ApiOperation({
      summary: "Get all exchange rates with cursor-based pagination",
    }),
    ApiQuery({ type: QueryExchangeRateDto }),
    ApiResponse({
      status: 200,
      description: "Exchange rates retrieved successfully",
      type: CursorPaginatedExchangeRateResponse,
    }),
  );

export const ApiGetAverageExchangeRate = () =>
  applyDecorators(
    ApiOperation({ summary: "Get average exchange rate" }),
    ApiQuery({ type: QueryExchangeRateDto }),
    ApiResponse({
      status: 200,
      description: "Average exchange rate retrieved successfully",
      type: Number,
    }),
  );
