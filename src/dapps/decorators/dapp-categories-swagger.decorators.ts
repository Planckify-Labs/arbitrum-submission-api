import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";

export function ApiGetAllDappCategories() {
  return applyDecorators(
    ApiOperation({ summary: "Get all dapp categories" }),
    ApiResponse({
      status: 200,
      description: "List of all dapp categories",
      example: [
        {
          id: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
          name: "DeFi",
          description: "Decentralized Finance applications",
          iconUrl: "https://example.com/icons/defi.svg",
          isActive: true,
          createdAt: "2025-09-23T09:42:39.119Z",
          updatedAt: "2025-09-23T09:42:39.119Z",
          _count: {
            dapps: 6,
          },
        },
        {
          id: "01K5V152FW38TPJYDR5C18C5D4",
          name: "DEX",
          description: "Decentralized Exchanges",
          iconUrl: "https://example.com/icons/dex.svg",
          isActive: true,
          createdAt: "2025-09-23T10:15:50.524Z",
          updatedAt: "2025-09-23T10:15:50.524Z",
          _count: {
            dapps: 4,
          },
        },
        {
          id: "01K5TZ89RFVPSSHF7DVKN5ESSP",
          name: "Gaming",
          description: "Blockchain gaming and NFT games",
          iconUrl: "https://example.com/icons/gaming.svg",
          isActive: true,
          createdAt: "2025-09-23T09:42:39.119Z",
          updatedAt: "2025-09-23T09:42:39.119Z",
          _count: {
            dapps: 5,
          },
        },
        {
          id: "01K5TZ89RFDFWKPVSZTK1M5762",
          name: "NFT",
          description: "Non-Fungible Token marketplaces and platforms",
          iconUrl: "https://example.com/icons/nft.svg",
          isActive: true,
          createdAt: "2025-09-23T09:42:39.119Z",
          updatedAt: "2025-09-23T09:42:39.119Z",
          _count: {
            dapps: 1,
          },
        },
        {
          id: "01K5TZ89RFQN43Z93FN7EEFGCB",
          name: "Social",
          description: "Decentralized social networks and platforms",
          iconUrl: "https://example.com/icons/social.svg",
          isActive: true,
          createdAt: "2025-09-23T09:42:39.119Z",
          updatedAt: "2025-09-23T09:42:39.119Z",
          _count: {
            dapps: 1,
          },
        },
        {
          id: "01K5TZ89RFKS8GC0JYJNDXDZ24",
          name: "Utilities",
          description: "Blockchain utilities and tools",
          iconUrl: "https://example.com/icons/utilities.svg",
          isActive: true,
          createdAt: "2025-09-23T09:42:39.119Z",
          updatedAt: "2025-09-23T09:42:39.119Z",
          _count: {
            dapps: 1,
          },
        },
      ],
    }),
  );
}

export function ApiGetDappCategoryById() {
  return applyDecorators(
    ApiOperation({ summary: "Get a specific dapp category by ID" }),
    ApiResponse({
      status: 200,
      description: "Dapp category details",
      example: {
        id: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
        name: "DeFi",
        description: "Decentralized Finance applications",
        iconUrl: "https://example.com/icons/defi.svg",
        isActive: true,
        createdAt: "2025-09-23T09:42:39.119Z",
        updatedAt: "2025-09-23T09:42:39.119Z",
        _count: {
          dapps: 6,
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: "Dapp category not found",
      example: {
        message: "Dapp category not found",
        statusCode: 404,
      },
    }),
  );
}

export function ApiCreateDappCategory() {
  return applyDecorators(
    ApiOperation({ summary: "Create a new dapp category (Admin only)" }),
    ApiResponse({
      status: 201,
      description: "Dapp category created successfully",
      example: {
        id: "01K5TZ89RFNEWCATEGORYID123",
        name: "Web3 Infrastructure",
        description: "Web3 infrastructure and development tools",
        iconUrl: "https://example.com/icons/infrastructure.svg",
        isActive: true,
        createdAt: "2025-09-23T12:00:00.000Z",
        updatedAt: "2025-09-23T12:00:00.000Z",
      },
    }),
    ApiResponse({
      status: 400,
      description: "Bad request - validation failed",
      example: {
        message: [
          "name should not be empty",
          "description should not be empty",
        ],
        statusCode: 400,
      },
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
      example: {
        message: "Unauthorized",
        statusCode: 401,
      },
    }),
    ApiResponse({
      status: 403,
      description: "Forbidden - admin access required",
      example: {
        message: "Forbidden resource",
        statusCode: 403,
      },
    }),
    ApiResponse({
      status: 409,
      description: "Conflict - category name already exists",
      example: {
        message: "Category name already exists",
        statusCode: 409,
      },
    }),
  );
}

export function ApiUpdateDappCategory() {
  return applyDecorators(
    ApiOperation({ summary: "Update a dapp category (Admin only)" }),
    ApiResponse({
      status: 200,
      description: "Dapp category updated successfully",
      example: {
        id: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
        name: "DeFi & Lending",
        description: "Decentralized Finance applications and lending protocols",
        iconUrl: "https://example.com/icons/defi-updated.svg",
        isActive: true,
        createdAt: "2025-09-23T09:42:39.119Z",
        updatedAt: "2025-09-23T12:30:00.000Z",
      },
    }),
    ApiResponse({
      status: 400,
      description: "Bad request - validation failed",
      example: {
        message: ["name should not be empty"],
        statusCode: 400,
      },
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
      example: {
        message: "Unauthorized",
        statusCode: 401,
      },
    }),
    ApiResponse({
      status: 403,
      description: "Forbidden - admin access required",
      example: {
        message: "Forbidden resource",
        statusCode: 403,
      },
    }),
    ApiResponse({
      status: 404,
      description: "Dapp category not found",
      example: {
        message: "Dapp category not found",
        statusCode: 404,
      },
    }),
    ApiResponse({
      status: 409,
      description: "Conflict - category name already exists",
      example: {
        message: "Category name already exists",
        statusCode: 409,
      },
    }),
  );
}

export function ApiDeleteDappCategory() {
  return applyDecorators(
    ApiOperation({ summary: "Delete a dapp category (Admin only)" }),
    ApiResponse({
      status: 200,
      description: "Dapp category deleted successfully",
      example: {
        message: "Dapp category deleted successfully",
      },
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
      example: {
        message: "Unauthorized",
        statusCode: 401,
      },
    }),
    ApiResponse({
      status: 403,
      description: "Forbidden - admin access required",
      example: {
        message: "Forbidden resource",
        statusCode: 403,
      },
    }),
    ApiResponse({
      status: 404,
      description: "Dapp category not found",
      example: {
        message: "Dapp category not found",
        statusCode: 404,
      },
    }),
    ApiResponse({
      status: 409,
      description: "Conflict - category has associated dapps",
      example: {
        message: "Cannot delete category with associated dapps",
        statusCode: 409,
      },
    }),
  );
}
