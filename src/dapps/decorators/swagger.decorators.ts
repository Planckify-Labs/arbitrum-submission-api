import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";

export function ApiGetAllDapps() {
  return applyDecorators(
    ApiOperation({ summary: "Get all dapps with pagination" }),
    ApiResponse({
      status: 200,
      description: "List of all dapps",
      example: [
        {
          id: "1inch-dapp",
          name: "1inch",
          description: "DEX aggregator with the best rates",
          logoUrl: "https://1inch.io/favicon.ico",
          websiteUrl: "https://1inch.io",
          categoryId: "01K5V152FW38TPJYDR5C18C5D4",
          isPopular: true,
          isSponsor: true,
          isHighlight: true,
          isActive: true,
          createdAt: "2025-09-23T10:15:50.528Z",
          updatedAt: "2025-09-23T10:15:50.528Z",
          appearance: { v: 1, background: { type: "solid", color: "#1B2A4E" } },
          category: {
            id: "01K5V152FW38TPJYDR5C18C5D4",
            name: "DEX",
            description: "Decentralized Exchanges",
            iconUrl: "https://example.com/icons/dex.svg",
            isActive: true,
            createdAt: "2025-09-23T10:15:50.524Z",
            updatedAt: "2025-09-23T10:15:50.524Z",
          },
          isFavorite: false,
        },
        {
          id: "opensea-dapp",
          name: "OpenSea",
          description: "The world's first and largest NFT marketplace",
          logoUrl: "https://opensea.io/static/images/logos/opensea-logo.svg",
          websiteUrl: "https://opensea.io",
          categoryId: "01K5TZ89RFDFWKPVSZTK1M5762",
          isPopular: true,
          isSponsor: true,
          isHighlight: true,
          isActive: true,
          createdAt: "2025-09-23T09:42:39.123Z",
          updatedAt: "2025-09-23T09:42:39.123Z",
          appearance: { v: 1, background: { type: "solid", color: "#2081E2" } },
          category: {
            id: "01K5TZ89RFDFWKPVSZTK1M5762",
            name: "NFT",
            description: "Non-Fungible Token marketplaces and platforms",
            iconUrl: "https://example.com/icons/nft.svg",
            isActive: true,
            createdAt: "2025-09-23T09:42:39.119Z",
            updatedAt: "2025-09-23T09:42:39.119Z",
          },
          isFavorite: false,
        },
      ],
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
      example: {
        message: "Unauthorized",
        statusCode: 401,
      },
    }),
  );
}

export function ApiGetPopularDapps() {
  return applyDecorators(
    ApiOperation({ summary: "Get popular dapps with pagination" }),
    ApiResponse({
      status: 200,
      description: "List of popular dapps",
      example: [
        {
          id: "splinterlands-dapp",
          name: "Splinterlands",
          description: "Digital trading card game on blockchain",
          logoUrl: "https://splinterlands.com/favicon.ico",
          websiteUrl: "https://splinterlands.com",
          categoryId: "01K5TZ89RFVPSSHF7DVKN5ESSP",
          isPopular: true,
          isSponsor: true,
          isHighlight: true,
          isActive: true,
          createdAt: "2025-09-23T10:15:50.528Z",
          updatedAt: "2025-09-23T10:15:50.528Z",
          appearance: { v: 1, background: { type: "solid", color: "#8B4513" } },
          category: {
            id: "01K5TZ89RFVPSSHF7DVKN5ESSP",
            name: "Gaming",
            description: "Blockchain gaming and NFT games",
            iconUrl: "https://example.com/icons/gaming.svg",
            isActive: true,
            createdAt: "2025-09-23T09:42:39.119Z",
            updatedAt: "2025-09-23T09:42:39.119Z",
          },
          isFavorite: false,
        },
        {
          id: "yearn-dapp",
          name: "Yearn Finance",
          description: "Yield farming made simple",
          logoUrl: "https://yearn.finance/favicon.ico",
          websiteUrl: "https://yearn.finance",
          categoryId: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
          isPopular: true,
          isSponsor: true,
          isHighlight: true,
          isActive: true,
          createdAt: "2025-09-23T10:15:50.528Z",
          updatedAt: "2025-09-23T10:15:50.528Z",
          appearance: { v: 1, background: { type: "solid", color: "#0657F9" } },
          category: {
            id: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
            name: "DeFi",
            description: "Decentralized Finance applications",
            iconUrl: "https://example.com/icons/defi.svg",
            isActive: true,
            createdAt: "2025-09-23T09:42:39.119Z",
            updatedAt: "2025-09-23T09:42:39.119Z",
          },
          isFavorite: false,
        },
      ],
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
      example: {
        message: "Unauthorized",
        statusCode: 401,
      },
    }),
  );
}

export function ApiGetSponsoredDapps() {
  return applyDecorators(
    ApiOperation({ summary: "Get sponsored dapps with pagination" }),
    ApiResponse({
      status: 200,
      description: "List of sponsored dapps",
      example: [
        {
          id: "sandbox-dapp",
          name: "The Sandbox",
          description: "Virtual world where players can build and monetize",
          logoUrl: "https://sandbox.game/favicon.ico",
          websiteUrl: "https://sandbox.game",
          categoryId: "01K5TZ89RFVPSSHF7DVKN5ESSP",
          isPopular: true,
          isSponsor: true,
          isHighlight: false,
          isActive: true,
          createdAt: "2025-09-23T10:15:50.528Z",
          updatedAt: "2025-09-23T10:15:50.528Z",
          appearance: { v: 1, background: { type: "solid", color: "#00ADEF" } },
          category: {
            id: "01K5TZ89RFVPSSHF7DVKN5ESSP",
            name: "Gaming",
            description: "Blockchain gaming and NFT games",
            iconUrl: "https://example.com/icons/gaming.svg",
            isActive: true,
            createdAt: "2025-09-23T09:42:39.119Z",
            updatedAt: "2025-09-23T09:42:39.119Z",
          },
          isFavorite: false,
        },
        {
          id: "lens-protocol-dapp",
          name: "Lens Protocol",
          description: "Decentralized social graph protocol",
          logoUrl: "https://lens.xyz/favicon.ico",
          websiteUrl: "https://lens.xyz",
          categoryId: "01K5TZ89RFQN43Z93FN7EEFGCB",
          isPopular: false,
          isSponsor: true,
          isHighlight: false,
          isActive: true,
          createdAt: "2025-09-23T09:42:39.123Z",
          updatedAt: "2025-09-23T09:42:39.123Z",
          appearance: { v: 1, background: { type: "solid", color: "#ABFE2C" } },
          category: {
            id: "01K5TZ89RFQN43Z93FN7EEFGCB",
            name: "Social",
            description: "Decentralized social networks and platforms",
            iconUrl: "https://example.com/icons/social.svg",
            isActive: true,
            createdAt: "2025-09-23T09:42:39.119Z",
            updatedAt: "2025-09-23T09:42:39.119Z",
          },
          isFavorite: false,
        },
      ],
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
      example: {
        message: "Unauthorized",
        statusCode: 401,
      },
    }),
  );
}

export function ApiGetFavoriteDapps() {
  return applyDecorators(
    ApiOperation({ summary: "Get user favorite dapps with pagination" }),
    ApiResponse({
      status: 200,
      description: "List of user favorite dapps",
      example: [
        {
          id: "pancakeswap-dapp",
          name: "PancakeSwap",
          description: "The most popular DEX on BNB Smart Chain",
          logoUrl: "https://pancakeswap.finance/favicon.ico",
          websiteUrl: "https://pancakeswap.finance",
          categoryId: "01K5V152FW38TPJYDR5C18C5D4",
          isPopular: true,
          isSponsor: true,
          isHighlight: false,
          isActive: true,
          createdAt: "2025-09-23T10:15:50.528Z",
          updatedAt: "2025-09-23T10:15:50.528Z",
          appearance: { v: 1, background: { type: "solid", color: "#1FC7D4" } },
          category: {
            id: "01K5V152FW38TPJYDR5C18C5D4",
            name: "DEX",
            description: "Decentralized Exchanges",
            iconUrl: "https://example.com/icons/dex.svg",
            isActive: true,
            createdAt: "2025-09-23T10:15:50.524Z",
            updatedAt: "2025-09-23T10:15:50.524Z",
          },
          isFavorite: true,
        },
      ],
    }),
    ApiResponse({
      status: 401,
      description: "Unauthorized - invalid or missing JWT token",
      example: {
        message: "Unauthorized",
        statusCode: 401,
      },
    }),
  );
}

export function ApiGetDappsByCategory() {
  return applyDecorators(
    ApiOperation({ summary: "Get dapps by category with pagination" }),
    ApiResponse({
      status: 200,
      description: "List of dapps in the specified category",
      example: [
        {
          id: "makerdao-dapp",
          name: "MakerDAO",
          description: "Decentralized credit platform on Ethereum",
          logoUrl: "https://makerdao.com/favicon.ico",
          websiteUrl: "https://makerdao.com",
          categoryId: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
          isPopular: true,
          isSponsor: true,
          isHighlight: false,
          isActive: true,
          createdAt: "2025-09-23T10:15:50.528Z",
          updatedAt: "2025-09-23T10:15:50.528Z",
          appearance: { v: 1, background: { type: "solid", color: "#1AAB9B" } },
          category: {
            id: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
            name: "DeFi",
            description: "Decentralized Finance applications",
            iconUrl: "https://example.com/icons/defi.svg",
            isActive: true,
            createdAt: "2025-09-23T09:42:39.119Z",
            updatedAt: "2025-09-23T09:42:39.119Z",
          },
          isFavorite: false,
        },
        {
          id: "yearn-dapp",
          name: "Yearn Finance",
          description: "Yield farming made simple",
          logoUrl: "https://yearn.finance/favicon.ico",
          websiteUrl: "https://yearn.finance",
          categoryId: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
          isPopular: true,
          isSponsor: true,
          isHighlight: true,
          isActive: true,
          createdAt: "2025-09-23T10:15:50.528Z",
          updatedAt: "2025-09-23T10:15:50.528Z",
          appearance: { v: 1, background: { type: "solid", color: "#0657F9" } },
          category: {
            id: "01K5TZ89RF4SPH1YA4MPS6ZX6J",
            name: "DeFi",
            description: "Decentralized Finance applications",
            iconUrl: "https://example.com/icons/defi.svg",
            isActive: true,
            createdAt: "2025-09-23T09:42:39.119Z",
            updatedAt: "2025-09-23T09:42:39.119Z",
          },
          isFavorite: false,
        },
      ],
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
      status: 404,
      description: "Category not found",
      example: {
        message: "Category not found",
        statusCode: 404,
      },
    }),
  );
}

export function ApiAddToFavorites() {
  return applyDecorators(
    ApiOperation({ summary: "Add dapp to favorites" }),
    ApiResponse({
      status: 201,
      description: "Dapp added to favorites successfully",
      example: {
        id: "01H1G5V8K2M3N4P5Q6R7S8T9U5",
        userId: "01H1G5V8K2M3N4P5Q6R7S8T9U4",
        dappId: "01H1G5V8K2M3N4P5Q6R7S8T9U0",
        createdAt: "2024-01-15T10:30:00.000Z",
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
      status: 404,
      description: "Dapp not found",
      example: {
        message: "Dapp not found",
        statusCode: 404,
      },
    }),
    ApiResponse({
      status: 409,
      description: "Dapp already in favorites",
      example: {
        message: "Dapp is already in favorites",
        statusCode: 409,
      },
    }),
  );
}

export function ApiRemoveFromFavorites() {
  return applyDecorators(
    ApiOperation({ summary: "Remove dapp from favorites" }),
    ApiResponse({
      status: 200,
      description: "Dapp removed from favorites successfully",
      example: {
        message: "Dapp removed from favorites successfully",
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
      status: 404,
      description: "Dapp not found or not in favorites",
      example: {
        message: "Dapp not found in favorites",
        statusCode: 404,
      },
    }),
  );
}

export function ApiGetDappById() {
  return applyDecorators(
    ApiOperation({ summary: "Get a specific dapp by ID" }),
    ApiResponse({
      status: 200,
      description: "Dapp details",
      example: {
        id: "opensea-dapp",
        name: "OpenSea",
        description: "The world's first and largest NFT marketplace",
        logoUrl: "https://opensea.io/static/images/logos/opensea-logo.svg",
        websiteUrl: "https://opensea.io",
        categoryId: "01K5TZ89RFDFWKPVSZTK1M5762",
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        createdAt: "2025-09-23T09:42:39.123Z",
        updatedAt: "2025-09-23T09:42:39.123Z",
        appearance: { v: 1, background: { type: "solid", color: "#2081E2" } },
        category: {
          id: "01K5TZ89RFDFWKPVSZTK1M5762",
          name: "NFT",
          description: "Non-Fungible Token marketplaces and platforms",
          iconUrl: "https://example.com/icons/nft.svg",
          isActive: true,
          createdAt: "2025-09-23T09:42:39.119Z",
          updatedAt: "2025-09-23T09:42:39.119Z",
        },
        isFavorite: true,
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
      status: 404,
      description: "Dapp not found",
      example: {
        message: "Dapp not found",
        statusCode: 404,
      },
    }),
  );
}

export function ApiCreateDapp() {
  return applyDecorators(
    ApiOperation({ summary: "Create a new dapp (Admin only)" }),
    ApiResponse({
      status: 201,
      description: "Dapp created successfully",
      example: {
        id: "01H1G5V8K2M3N4P5Q6R7S8T9U6",
        name: "PancakeSwap",
        description: "Decentralized exchange on Binance Smart Chain",
        logoUrl: "https://example.com/pancakeswap-logo.png",
        websiteUrl: "https://pancakeswap.finance",
        categoryId: "01H1G5V8K2M3N4P5Q6R7S8T9U1",
        isPopular: false,
        isSponsor: false,
        isHighlight: false,
        isActive: true,
        appearance: { v: 1, background: { type: "solid", color: "#1FC7D4" } },
        createdAt: "2024-01-15T10:30:00.000Z",
        updatedAt: "2024-01-15T10:30:00.000Z",
      },
    }),
    ApiResponse({
      status: 400,
      description: "Bad request - validation failed",
      example: {
        message: [
          "name should not be empty",
          "websiteUrl must be a URL address",
          "categoryId should not be empty",
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
  );
}

export function ApiUpdateDapp() {
  return applyDecorators(
    ApiOperation({ summary: "Update a dapp (Admin only)" }),
    ApiResponse({
      status: 200,
      description: "Dapp updated successfully",
      example: {
        id: "01H1G5V8K2M3N4P5Q6R7S8T9U0",
        name: "Uniswap V3",
        description:
          "Updated decentralized exchange protocol with concentrated liquidity",
        logoUrl: "https://example.com/uniswap-v3-logo.png",
        websiteUrl: "https://uniswap.org",
        categoryId: "01H1G5V8K2M3N4P5Q6R7S8T9U1",
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        appearance: { v: 1, background: { type: "solid", color: "#FF007A" } },
        createdAt: "2024-01-15T10:30:00.000Z",
        updatedAt: "2024-01-15T11:45:00.000Z",
      },
    }),
    ApiResponse({
      status: 400,
      description: "Bad request - validation failed",
      example: {
        message: ["websiteUrl must be a URL address"],
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
      description: "Dapp not found",
      example: {
        message: "Dapp not found",
        statusCode: 404,
      },
    }),
  );
}

export function ApiDeleteDapp() {
  return applyDecorators(
    ApiOperation({ summary: "Delete a dapp (Admin only)" }),
    ApiResponse({
      status: 200,
      description: "Dapp deleted successfully",
      example: {
        message: "Dapp deleted successfully",
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
      description: "Dapp not found",
      example: {
        message: "Dapp not found",
        statusCode: 404,
      },
    }),
  );
}
