import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";

const productSchema = {
  type: "object",
  properties: {
    id: { type: "string", example: "01H1G5V..." },
    name: { type: "string", example: "Mobile Legends" },
    code: { type: "string", example: "MLBB" },
    vendorId: { type: "string", example: "01H1G5V..." },
    categoryId: { type: "string", example: "01H1G5V..." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const notFoundResponse = {
  status: 404,
  description: "Product not found",
  schema: {
    type: "object",
    properties: {
      message: { type: "string", example: "Product not found" },
      error: { type: "string", example: "Not Found" },
      statusCode: { type: "number", example: 404 },
    },
  },
};

const badRequestResponse = {
  status: 400,
  description: "Bad request - Invalid input",
  schema: {
    type: "object",
    properties: {
      message: {
        type: "array",
        items: { type: "string" },
        example: ["name must not be empty"],
      },
      error: { type: "string", example: "Bad Request" },
      statusCode: { type: "number", example: 400 },
    },
  },
};

const categorySchema = {
  type: "object",
  properties: {
    id: { type: "string", example: "01H1G5V..." },
    name: { type: "string", example: "Gaming Top Up" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

export function ApiGetProducts() {
  return applyDecorators(
    ApiOperation({
      summary: "Get all products",
      description:
        "Retrieves a list of all products with their complete details",
    }),
    ApiResponse({
      status: 200,
      description: "Returns all products with their related data",
      schema: {
        type: "array",
        items: productSchema,
      },
    }),
  );
}

export function ApiGetProductsByCategory() {
  return applyDecorators(
    ApiOperation({
      summary: "Get products by category",
      description: "Retrieves a list of products filtered by category ID",
    }),
    ApiParam({
      name: "categoryId",
      description: "Category ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Returns products for the specified category",
      schema: {
        type: "array",
        items: productSchema,
      },
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiGetProduct() {
  return applyDecorators(
    ApiOperation({
      summary: "Get a product by ID",
      description: "Retrieves detailed information about a specific product",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Returns the product with the specified ID",
      schema: productSchema,
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiCreateProduct() {
  return applyDecorators(
    ApiOperation({
      summary: "Create a new product",
      description: "Creates a new product with the provided details",
    }),
    ApiResponse({
      status: 201,
      description: "The product has been successfully created",
      schema: productSchema,
    }),
    ApiResponse(badRequestResponse),
  );
}

export function ApiUpdateProduct() {
  return applyDecorators(
    ApiOperation({
      summary: "Update a product",
      description: "Updates an existing product with the provided details",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "The product has been successfully updated",
      schema: productSchema,
    }),
    ApiResponse(notFoundResponse),
    ApiResponse(badRequestResponse),
  );
}

export function ApiDeleteProduct() {
  return applyDecorators(
    ApiOperation({
      summary: "Delete a product",
      description: "Removes a product from the system",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 204,
      description: "The product has been successfully deleted",
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiGetCategories() {
  return applyDecorators(
    ApiOperation({
      summary: "Get all product categories",
      description: "Retrieves a list of all available product categories",
    }),
    ApiResponse({
      status: 200,
      description: "Returns all product categories",
      schema: {
        type: "array",
        items: categorySchema,
      },
    }),
  );
}
