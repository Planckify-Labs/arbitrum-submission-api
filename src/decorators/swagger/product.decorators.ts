import { applyDecorators } from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";

const productSchema = {
  type: "object",
  properties: {
    id: { type: "string", example: "01H1G5V..." },
    name: { type: "string", example: "Mobile Legends" },
    code: { type: "string", example: "MLBB" },
    categoryId: { type: "string", example: "01H1G5V..." },
    description: {
      type: "string",
      example: "Mobile Legends: Bang Bang game credits",
    },
    imageUrl: { type: "string", example: "https://example.com/mlbb.jpg" },
    isActive: { type: "boolean", example: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          sku: { type: "string" },
        },
      },
    },
    inputFields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          forms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", example: "no_hp" },
                type: {
                  type: "string",
                  enum: ["TEXT", "NUMBER", "EMAIL", "OPTION", "DATE"],
                  example: "TEXT",
                },
                alias: { type: "string", example: "Phone Number" },
                description: {
                  type: "string",
                  example: "Enter your phone number in international format",
                },
                isRequired: { type: "boolean", example: true },
                options: {
                  type: "array",
                  items: { type: "string" },
                  example: ["Option 1", "Option 2"],
                },
              },
            },
          },
        },
      },
    },
  },
};

const productPriceSchema = {
  type: "object",
  properties: {
    id: { type: "string", example: "01H1G5V..." },
    productId: { type: "string", example: "01H1G5V..." },
    vendorId: { type: "string", example: "01H1G5V..." },
    realValue: { type: "number", example: 50000 },
    priceFromVendor: { type: "number", example: 47500 },
    sellPrice: { type: "number", example: 52500 },
    isActive: { type: "boolean", example: true },
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

const productsGroupedByCategoriesResponse = {
  type: "array",
  items: {
    type: "object",
    properties: {
      category: { type: "string", example: "Gaming Top Up" },
      products: {
        type: "array",
        items: productSchema,
      },
    },
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

export function ApiGetProductByCode() {
  return applyDecorators(
    ApiOperation({
      summary: "Get a product by code",
      description:
        "Retrieves detailed information about a specific product using its code",
    }),
    ApiParam({
      name: "code",
      description: "Product Code",
      example: "MLBB",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Returns the product with the specified code",
      schema: productSchema,
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiSearchProducts() {
  return applyDecorators(
    ApiOperation({
      summary: "Search products",
      description:
        "Search products using various criteria. You can search by ID, code, name, vendor name, or use a general query term. Additional filters for vendor ID and active status are also available.",
    }),
    ApiQuery({
      name: "id",
      required: false,
      description: "Search by exact product ID",
      type: "string",
      example: "01JWN873BV2XXFVVMYR1JMY71E",
    }),
    ApiQuery({
      name: "code",
      required: false,
      description: "Search by product code (case insensitive)",
      type: "string",
      example: "MLBB",
    }),
    ApiQuery({
      name: "name",
      required: false,
      description: "Search by product name (case insensitive)",
      type: "string",
      example: "Mobile Legends",
    }),
    ApiQuery({
      name: "vendorName",
      required: false,
      description: "Search by vendor name (case insensitive)",
      type: "string",
      example: "Game Publisher Inc",
    }),
    ApiQuery({
      name: "query",
      required: false,
      description:
        "General search term that matches against name, code, or vendor name (used only if specific search fields are not provided)",
      type: "string",
    }),
    ApiQuery({
      name: "vendorId",
      required: false,
      description: "Filter by vendor ID",
      type: "string",
    }),
    ApiQuery({
      name: "active",
      required: false,
      description: "Filter by active status",
      type: "boolean",
    }),
    ApiResponse({
      status: 200,
      description: "Returns matching products",
      schema: {
        type: "array",
        items: productSchema,
      },
    }),
  );
}

export function ApiGetProductPrices() {
  return applyDecorators(
    ApiOperation({
      summary: "Get product prices",
      description: "Get all prices for a specific product",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Returns all prices for the product",
      schema: {
        type: "array",
        items: productPriceSchema,
      },
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiCreateProductPrice() {
  return applyDecorators(
    ApiOperation({
      summary: "Create a new product price",
      description: "Creates a new price for a product variant",
    }),
    ApiBody({
      schema: {
        type: "object",
        required: [
          "productVariantId",
          "vendorId",
          "realValue",
          "priceFromVendor",
          "sellPrice",
        ],
        properties: {
          productVariantId: {
            type: "string",
            description: "ID of the product variant",
            example: "01H1G5V...",
          },
          vendorId: {
            type: "string",
            description: "ID of the vendor",
            example: "01H1G5V...",
          },
          realValue: {
            type: "number",
            description: "Real value of the product",
            example: 50000,
          },
          priceFromVendor: {
            type: "number",
            description: "Price from the vendor",
            example: 47500,
          },
          sellPrice: {
            type: "number",
            description: "Selling price of the product",
            example: 52500,
          },
          isActive: {
            type: "boolean",
            description: "Whether the price is active",
            example: true,
          },
        },
      },
    }),
    ApiResponse({
      status: 201,
      description: "Price created successfully",
      schema: productPriceSchema,
    }),
    ApiResponse(badRequestResponse),
  );
}

export function ApiUpdateProductPrice() {
  return applyDecorators(
    ApiOperation({
      summary: "Update product price",
      description: "Update an existing product price",
    }),
    ApiParam({
      name: "priceId",
      description: "Price ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Price updated successfully",
      schema: productPriceSchema,
    }),
    ApiResponse(notFoundResponse),
    ApiResponse(badRequestResponse),
  );
}

export function ApiDeleteProductPrice() {
  return applyDecorators(
    ApiOperation({
      summary: "Delete product price",
      description: "Delete an existing product price",
    }),
    ApiParam({
      name: "priceId",
      description: "Price ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 204,
      description: "Price deleted successfully",
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiCreateCategory() {
  return applyDecorators(
    ApiOperation({
      summary: "Create category",
      description: "Create a new product category",
    }),
    ApiResponse({
      status: 201,
      description: "Category created successfully",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          name: { type: "string", example: "Games" },
          description: {
            type: "string",
            example: "Digital games and gaming products",
          },
          imageUrl: {
            type: "string",
            example: "https://example.com/games.jpg",
          },
          isActive: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    }),
    ApiResponse(badRequestResponse),
  );
}

export function ApiGetCategory() {
  return applyDecorators(
    ApiOperation({
      summary: "Get category",
      description: "Get a specific category by ID",
    }),
    ApiParam({
      name: "id",
      description: "Category ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Returns the category",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          name: { type: "string", example: "Games" },
          description: {
            type: "string",
            example: "Digital games and gaming products",
          },
          imageUrl: {
            type: "string",
            example: "https://example.com/games.jpg",
          },
          isActive: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiUpdateCategory() {
  return applyDecorators(
    ApiOperation({
      summary: "Update category",
      description: "Update an existing category",
    }),
    ApiParam({
      name: "id",
      description: "Category ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 200,
      description: "Category updated successfully",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          name: { type: "string", example: "Games" },
          description: {
            type: "string",
            example: "Digital games and gaming products",
          },
          imageUrl: {
            type: "string",
            example: "https://example.com/games.jpg",
          },
          isActive: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    }),
    ApiResponse(notFoundResponse),
    ApiResponse(badRequestResponse),
  );
}

export function ApiDeleteCategory() {
  return applyDecorators(
    ApiOperation({
      summary: "Delete category",
      description: "Delete an existing category",
    }),
    ApiParam({
      name: "id",
      description: "Category ID",
      example: "01H1G5V...",
    }),
    ApiResponse({
      status: 204,
      description: "Category deleted successfully",
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiGetProductVariants() {
  return applyDecorators(
    ApiOperation({
      summary: "Get product variants",
      description: "Retrieves all variants for a specific product",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Returns all variants for the product",
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", example: "01H1G5V..." },
            name: { type: "string", example: "60 Diamonds" },
            description: {
              type: "string",
              example: "60 Mobile Legends Diamonds",
            },
            sku: { type: "string", example: "MLBB-60D" },
            productId: { type: "string", example: "01H1G5V..." },
            isActive: { type: "boolean", example: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            ProductPrice: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  vendorId: { type: "string" },
                  realValue: { type: "number" },
                  priceFromVendor: { type: "number" },
                  sellPrice: { type: "number" },
                  isActive: { type: "boolean" },
                  vendor: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiSearchProductVariants() {
  return applyDecorators(
    ApiOperation({
      summary: "Search product variants",
      description: "Search product variants using various criteria",
    }),
    ApiQuery({
      name: "sku",
      required: false,
      description: "Search by SKU (case insensitive)",
      type: "string",
      example: "MLBB-60D",
    }),
    ApiQuery({
      name: "name",
      required: false,
      description: "Search by variant name (case insensitive)",
      type: "string",
      example: "60 Diamonds",
    }),
    ApiQuery({
      name: "productId",
      required: false,
      description: "Filter by product ID",
      type: "string",
      example: "01H1G5V...",
    }),
    ApiQuery({
      name: "isActive",
      required: false,
      description: "Filter by active status",
      type: "boolean",
    }),
    ApiQuery({
      name: "query",
      required: false,
      description: "General search term that matches against name or SKU",
      type: "string",
    }),
    ApiResponse({
      status: 200,
      description: "Returns matching product variants",
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", example: "01H1G5V..." },
            name: { type: "string", example: "60 Diamonds" },
            sku: { type: "string", example: "MLBB-60D" },
            productId: { type: "string", example: "01H1G5V..." },
            isActive: { type: "boolean", example: true },
          },
        },
      },
    }),
  );
}

export function ApiGetProductVariant() {
  return applyDecorators(
    ApiOperation({
      summary: "Get a product variant by ID",
      description:
        "Retrieves detailed information about a specific product variant",
    }),
    ApiParam({
      name: "id",
      description: "Product Variant ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Returns the product variant with the specified ID",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          name: { type: "string", example: "60 Diamonds" },
          description: {
            type: "string",
            example: "60 Mobile Legends Diamonds",
          },
          sku: { type: "string", example: "MLBB-60D" },
          productId: { type: "string", example: "01H1G5V..." },
          isActive: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          product: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              code: { type: "string" },
            },
          },
          ProductPrice: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                vendorId: { type: "string" },
                realValue: { type: "number" },
                priceFromVendor: { type: "number" },
                sellPrice: { type: "number" },
                isActive: { type: "boolean" },
                vendor: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiGetProductsGroupedByCategories() {
  return applyDecorators(
    ApiOperation({
      summary: "Get all products grouped by categories",
      description:
        "Retrieves a list of all products organized by their categories.",
    }),
    ApiResponse({
      status: 200,
      description:
        "Returns all products grouped by their respective categories.",
      schema: productsGroupedByCategoriesResponse,
    }),
    ApiQuery({
      name: "take",
      required: false,
      type: Number,
      description: "total product to take from each categories",
      example: 10,
    }),
  );
}

export function ApiGetProductInputField() {
  return applyDecorators(
    ApiOperation({
      summary: "Get product input fields",
      description:
        "Retrieves input fields configuration for a specific product",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: "Returns the input fields for the specified product",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          productId: { type: "string", example: "01H1G5V..." },
          forms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", example: "no_hp" },
                type: {
                  type: "string",
                  enum: ["TEXT", "NUMBER", "EMAIL", "OPTION", "DATE"],
                  example: "TEXT",
                },
                alias: { type: "string", example: "Phone Number" },
                description: {
                  type: "string",
                  example: "Enter your phone number in international format",
                },
                isRequired: { type: "boolean", example: true },
                options: {
                  type: "array",
                  items: { type: "string" },
                  example: ["Option 1", "Option 2"],
                },
              },
            },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    }),
    ApiResponse(notFoundResponse),
  );
}

export function ApiCreateProductInputField() {
  return applyDecorators(
    ApiOperation({
      summary: "Create product input fields",
      description: "Creates input fields configuration for a specific product",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiBody({
      schema: {
        type: "object",
        required: ["fields"],
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              required: ["key", "type", "alias"],
              properties: {
                key: { type: "string", example: "no_hp" },
                type: {
                  type: "string",
                  enum: ["TEXT", "NUMBER", "EMAIL", "OPTION", "DATE"],
                  example: "TEXT",
                },
                alias: { type: "string", example: "Phone Number" },
                description: {
                  type: "string",
                  example: "Enter your phone number in international format",
                },
                isRequired: { type: "boolean", example: true },
                options: {
                  type: "array",
                  items: { type: "string" },
                  example: ["Option 1", "Option 2"],
                },
              },
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 201,
      description: "Input fields configuration has been successfully created",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          productId: { type: "string", example: "01H1G5V..." },
          forms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", example: "no_hp" },
                type: {
                  type: "string",
                  enum: ["TEXT", "NUMBER", "EMAIL", "OPTION", "DATE"],
                  example: "TEXT",
                },
                alias: { type: "string", example: "Phone Number" },
                description: {
                  type: "string",
                  example: "Enter your phone number in international format",
                },
                isRequired: { type: "boolean", example: true },
                options: {
                  type: "array",
                  items: { type: "string" },
                  example: ["Option 1", "Option 2"],
                },
              },
            },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    }),
    ApiResponse(badRequestResponse),
    ApiResponse(notFoundResponse),
  );
}

export function ApiUpdateProductInputField() {
  return applyDecorators(
    ApiOperation({
      summary: "Update product input fields",
      description: "Updates input fields configuration for a specific product",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiParam({
      name: "fieldId",
      description: "Input Field ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiBody({
      schema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              required: ["key", "type", "alias"],
              properties: {
                key: { type: "string", example: "no_hp" },
                type: {
                  type: "string",
                  enum: ["TEXT", "NUMBER", "EMAIL", "OPTION", "DATE"],
                  example: "TEXT",
                },
                alias: { type: "string", example: "Phone Number" },
                description: {
                  type: "string",
                  example: "Enter your phone number in international format",
                },
                isRequired: { type: "boolean", example: true },
                options: {
                  type: "array",
                  items: { type: "string" },
                  example: ["Option 1", "Option 2"],
                },
              },
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: "Input fields configuration has been successfully updated",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", example: "01H1G5V..." },
          productId: { type: "string", example: "01H1G5V..." },
          forms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", example: "no_hp" },
                type: {
                  type: "string",
                  enum: ["TEXT", "NUMBER", "EMAIL", "OPTION", "DATE"],
                  example: "TEXT",
                },
                alias: { type: "string", example: "Phone Number" },
                description: {
                  type: "string",
                  example: "Enter your phone number in international format",
                },
                isRequired: { type: "boolean", example: true },
                options: {
                  type: "array",
                  items: { type: "string" },
                  example: ["Option 1", "Option 2"],
                },
              },
            },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    }),
    ApiResponse(badRequestResponse),
    ApiResponse(notFoundResponse),
  );
}

export function ApiDeleteProductInputField() {
  return applyDecorators(
    ApiOperation({
      summary: "Delete product input fields",
      description: "Removes input fields configuration for a specific product",
    }),
    ApiParam({
      name: "id",
      description: "Product ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiParam({
      name: "fieldId",
      description: "Input Field ID",
      example: "01H1G5V...",
      required: true,
    }),
    ApiResponse({
      status: 204,
      description: "Input fields configuration has been successfully deleted",
    }),
    ApiResponse(notFoundResponse),
  );
}
