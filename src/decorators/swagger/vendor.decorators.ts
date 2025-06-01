import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { VendorResponseDto } from "../../vendors/dto/vendor-response.dto";
import { ProductResponseDto } from "../../products/dto/product-response.dto";

export function ApiGetVendors() {
  return applyDecorators(
    ApiOperation({ summary: "Get all vendors" }),
    ApiResponse({
      status: 200,
      description: "Returns a list of vendors",
      type: VendorResponseDto,
      isArray: true,
    }),
  );
}

export function ApiGetVendor() {
  return applyDecorators(
    ApiOperation({ summary: "Get vendor by ID" }),
    ApiParam({ name: "id", description: "Vendor ID" }),
    ApiResponse({
      status: 200,
      description: "Returns a vendor",
      type: VendorResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "Vendor not found",
    }),
  );
}

export function ApiCreateVendor() {
  return applyDecorators(
    ApiOperation({ summary: "Create a new vendor" }),
    ApiResponse({
      status: 201,
      description: "Vendor created successfully",
      type: VendorResponseDto,
    }),
  );
}

export function ApiUpdateVendor() {
  return applyDecorators(
    ApiOperation({ summary: "Update vendor" }),
    ApiParam({ name: "id", description: "Vendor ID" }),
    ApiResponse({
      status: 200,
      description: "Vendor updated successfully",
      type: VendorResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: "Vendor not found",
    }),
  );
}

export function ApiDeleteVendor() {
  return applyDecorators(
    ApiOperation({ summary: "Delete vendor" }),
    ApiParam({ name: "id", description: "Vendor ID" }),
    ApiResponse({
      status: 204,
      description: "Vendor deleted successfully",
    }),
    ApiResponse({
      status: 404,
      description: "Vendor not found",
    }),
  );
}

export function ApiGetVendorProducts() {
  return applyDecorators(
    ApiOperation({ summary: "Get vendor's products" }),
    ApiParam({ name: "id", description: "Vendor ID" }),
    ApiResponse({
      status: 200,
      description: "Returns vendor's products",
      type: ProductResponseDto,
      isArray: true,
    }),
    ApiResponse({
      status: 404,
      description: "Vendor not found",
    }),
  );
}
