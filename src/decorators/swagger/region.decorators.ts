import { applyDecorators } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { RegionResponseDto } from "../../regions/dto/region-response.dto";
import { RegionTokenResponseDto } from "../../regions/dto/region-token-response.dto";

export function ApiGetRegions() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Get all regions" }),
    ApiResponse({
      status: 200,
      description: "Returns all regions",
      type: RegionResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetRegion() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Get region by ID" }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({
      status: 200,
      description: "Returns the region",
      type: RegionResponseDto,
    }),
    ApiResponse({ status: 404, description: "Region not found" }),
  );
}

export function ApiCreateRegion() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Create new region" }),
    ApiResponse({
      status: 201,
      description: "Region created successfully",
      type: RegionResponseDto,
    }),
    ApiResponse({ status: 400, description: "Invalid input" }),
  );
}

export function ApiUpdateRegion() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Update region" }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({
      status: 200,
      description: "Region updated successfully",
      type: RegionResponseDto,
    }),
    ApiResponse({ status: 404, description: "Region not found" }),
    ApiResponse({ status: 400, description: "Invalid input" }),
  );
}

export function ApiDeleteRegion() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Delete region" }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({ status: 204, description: "Region deleted successfully" }),
    ApiResponse({ status: 404, description: "Region not found" }),
  );
}

export function ApiGetRegionTokens() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Get region available tokens" }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({
      status: 200,
      description: "Returns region available tokens",
      type: RegionTokenResponseDto,
      isArray: true,
    }),
    ApiResponse({ status: 404, description: "Region not found" }),
  );
}

export function ApiCreateRegionToken() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Add token to region" }),
    ApiParam({ name: "id", type: "string" }),
    ApiResponse({
      status: 201,
      description: "Token added to region successfully",
      type: RegionTokenResponseDto,
    }),
    ApiResponse({ status: 404, description: "Region or token not found" }),
    ApiResponse({ status: 400, description: "Invalid input" }),
  );
}

export function ApiUpdateRegionToken() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Update region token settings" }),
    ApiParam({ name: "id", type: "string" }),
    ApiParam({ name: "tokenId", type: "string" }),
    ApiResponse({
      status: 200,
      description: "Region token settings updated successfully",
      type: RegionTokenResponseDto,
    }),
    ApiResponse({ status: 404, description: "Region token not found" }),
    ApiResponse({ status: 400, description: "Invalid input" }),
  );
}

export function ApiDeleteRegionToken() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Remove token from region" }),
    ApiParam({ name: "id", type: "string" }),
    ApiParam({ name: "tokenId", type: "string" }),
    ApiResponse({
      status: 204,
      description: "Token removed from region successfully",
    }),
    ApiResponse({ status: 404, description: "Region token not found" }),
  );
}

export function ApiSearchRegions() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: "Search regions with filters" }),
    ApiQuery({ name: "code", type: String, required: false }),
    ApiQuery({ name: "name", type: String, required: false }),
    ApiQuery({ name: "currencyCode", type: String, required: false }),
    ApiQuery({ name: "isActive", type: Boolean, required: false }),
    ApiQuery({ name: "hasKYCRequirement", type: Boolean, required: false }),
    ApiResponse({
      status: 200,
      description: "Returns filtered regions",
      type: RegionResponseDto,
      isArray: true,
    }),
  );
}
