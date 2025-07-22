import { applyDecorators } from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from "@nestjs/swagger";

export function ApiGetNonce() {
  return applyDecorators(
    ApiOperation({ summary: "Get a nonce for SIWE authentication" }),
    ApiParam({
      name: "walletAddress",
      description: "Ethereum wallet address",
      example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    }),
    ApiQuery({
      name: "chainId",
      description: "Blockchain chain ID (e.g., 1 for Ethereum Mainnet)",
      required: false,
      type: Number,
      example: 1,
    }),
    ApiResponse({
      status: 200,
      description: "Returns a nonce and SIWE message",
      schema: {
        type: "object",
        properties: {
          nonce: { type: "string" },
          message: { type: "string" },
        },
      },
    }),
    ApiResponse({
      status: 400,
      description: "Invalid wallet address",
    }),
  );
}

export function ApiVerify() {
  return applyDecorators(
    ApiOperation({ summary: "Verify SIWE signature and login" }),
    ApiBody({
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
          signature: { type: "string" },
        },
        required: ["message", "signature"],
      },
    }),
    ApiResponse({
      status: 200,
      description: "Returns authentication tokens",
      schema: {
        type: "object",
        properties: {
          access_token: { type: "string" },
          refresh_token: { type: "string" },
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              walletAddress: { type: "string" },
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 401,
      description: "Invalid signature",
    }),
  );
}

export function ApiRefresh() {
  return applyDecorators(
    ApiOperation({ summary: "Refresh access token" }),
    ApiBody({
      schema: {
        type: "object",
        properties: {
          refresh_token: { type: "string" },
        },
        required: ["refresh_token"],
      },
    }),
    ApiResponse({
      status: 200,
      description: "Returns new access token",
      schema: {
        type: "object",
        properties: {
          access_token: { type: "string" },
        },
      },
    }),
    ApiResponse({
      status: 401,
      description: "Invalid refresh token",
    }),
  );
}

export function ApiGetMe() {
  return applyDecorators(
    ApiOperation({ summary: "Get current user profile" }),
    ApiBearerAuth(),
    ApiResponse({
      status: 200,
      description: "Returns user profile",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          walletAddress: { type: "string" },
        },
      },
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized",
    }),
  );
}
