import { PrismaClient } from "../../../generated/prisma";
import * as crypto from "crypto";

interface VCGamersProduct {
  key: string;
  name: string;
  image_url: string;
  description?: string;
  is_voucher: boolean;
  is_active: boolean;
  forms?: Array<{
    key: string;
    type: string;
    alias: string;
    options?: string[];
  }>;
}

interface VCGamersVariant {
  key: string;
  variation_name: string;
  brand_name: string;
  price: number;
  is_active: boolean;
  sla: number;
  is_new: boolean;
}

const vcGamersAPI = {
  createSignature: (params: string): string => {
    const secret = "8aa3a704a9c2af43c636df2e59828777";
    const hmac = crypto
      .createHmac("sha512", secret)
      .update(params)
      .digest("hex");
    return Buffer.from(hmac).toString("base64");
  },

  getProducts: async (): Promise<{
    statusCode: number;
    data?: VCGamersProduct[];
  }> => {
    try {
      const paramsSignature = "8aa3a704a9c2af43c636df2e59828777" + "brand";
      const signature = vcGamersAPI.createSignature(paramsSignature);
      const URL_BRAND = `https://mitra-api.vcgamers.com/v2/public/brands?sign=${signature}`;

      const fetchResponse = await fetch(URL_BRAND, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization:
            "Bearer 4d5855d626b5558e155ce6eddb7f370e7749f2e6fee891556e879d46cadb276e8c7a25a4b841efb5972e6d3d9aa2f201bb4d",
        },
      });

      const response = await fetchResponse.json();
      console.log("VCGamers API response:", response);

      if (response.code !== 200) {
        return {
          statusCode: 400,
        };
      }

      return {
        statusCode: 200,
        data: response?.data,
      };
    } catch (err) {
      console.error("Error fetching VCGamers products:", err);
      return {
        statusCode: 500,
      };
    }
  },

  getProductVariants: async (
    brandKey: string,
  ): Promise<{
    statusCode: number;
    data?: VCGamersVariant[];
  }> => {
    try {
      const paramsSignature =
        "8aa3a704a9c2af43c636df2e59828777" + "variation" + brandKey;
      const signature = vcGamersAPI.createSignature(paramsSignature);
      const URL_VARIATION = `https://mitra-api.vcgamers.com/v2/public/variations?brand_key=${brandKey}&sign=${signature}`;

      const fetchResponse = await fetch(URL_VARIATION, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization:
            "Bearer 4d5855d626b5558e155ce6eddb7f370e7749f2e6fee891556e879d46cadb276e8c7a25a4b841efb5972e6d3d9aa2f201bb4d",
        },
      });

      const response = await fetchResponse.json();
      console.log(`VCGamers variants for ${brandKey}:`, response);

      if (response.code !== 200) {
        return {
          statusCode: 400,
        };
      }

      return {
        statusCode: 200,
        data: response?.data,
      };
    } catch (err) {
      console.error(`Error fetching VCGamers variants for ${brandKey}:`, err);
      return {
        statusCode: 500,
      };
    }
  },
};

const prisma = new PrismaClient();

async function main() {
  const regions = await Promise.all([
    prisma.region.upsert({
      where: { code: "ID" },
      update: {},
      create: {
        code: "ID",
        name: "Indonesia",
        currencyCode: "IDR",
        isActive: true,
        taxRate: 11,
        supportEmail: "support-id@takumipay.com",
        supportPhone: "+62123456789",
      },
    }),
    prisma.region.upsert({
      where: { code: "SG" },
      update: {},
      create: {
        code: "SG",
        name: "Singapore",
        currencyCode: "SGD",
        isActive: true,
        taxRate: 7,
        supportEmail: "support-sg@takumipay.com",
        supportPhone: "+6587654321",
      },
    }),
  ]);

  const blockchains = await Promise.all([
    prisma.blockchain.upsert({
      where: { chainId: 1 },
      update: {},
      create: {
        name: "Ethereum",
        chainId: 1,
        rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/demo",
        blockExplorer: "https://etherscan.io",
        isEVM: true,
        isActive: true,
      },
    }),
    prisma.blockchain.upsert({
      where: { chainId: 137 },
      update: {},
      create: {
        name: "Polygon",
        chainId: 137,
        rpcUrl: "https://polygon-rpc.com",
        blockExplorer: "https://polygonscan.com",
        isEVM: true,
        isActive: true,
      },
    }),
  ]);

  const contractABIs = await Promise.all([
    prisma.contractABI.upsert({
      where: { name: "ERC20" },
      update: {},
      create: {
        name: "ERC20",
        description: "Standard ERC20 token interface",
        version: "1.0.0",
        abi: JSON.parse(
          `[{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"}]`,
        ),
        isVerified: true,
      },
    }),
    prisma.contractABI.upsert({
      where: { name: "PaymentProcessor" },
      update: {},
      create: {
        name: "PaymentProcessor",
        description: "Payment processor contract",
        version: "1.0.0",
        abi: JSON.parse(
          `[{"inputs":[{"internalType":"address","name":"_token","type":"address"}],"stateMutability":"nonpayable","type":"constructor"}]`,
        ),
        isVerified: true,
      },
    }),
  ]);

  await Promise.all([
    prisma.smartContract.upsert({
      where: { id: "smart-contract-usdt" },
      update: {},
      create: {
        id: "smart-contract-usdt",
        name: "USDT Contract",
        blockchainId: blockchains[0].id,
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        abiId: contractABIs[0].id,
        isActive: true,
      },
    }),
    prisma.smartContract.upsert({
      where: { id: "smart-contract-payment" },
      update: {},
      create: {
        id: "smart-contract-payment",
        name: "Payment Processor",
        blockchainId: blockchains[1].id,
        address: "0x1234567890123456789012345678901234567890",
        abiId: contractABIs[1].id,
        isActive: true,
      },
    }),
  ]);

  const tokens = await Promise.all([
    prisma.token.upsert({
      where: { contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
      update: {},
      create: {
        name: "Tether USD",
        symbol: "USDT",
        decimals: 6,
        blockchainId: blockchains[0].id,
        contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        logoUrl:
          "https://assets.coingecko.com/coins/images/325/small/Tether.png",
        isStablecoin: true,
        isActive: true,
      },
    }),
    prisma.token.upsert({
      where: { contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
      update: {},
      create: {
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        blockchainId: blockchains[0].id,
        contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        logoUrl:
          "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
        isStablecoin: true,
        isActive: true,
      },
    }),
  ]);

  const nativeTokens = await Promise.all([
    prisma.token.upsert({
      where: { contractAddress: "0x0000000000000000000000000000000000000000" },
      update: {},
      create: {
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        blockchainId: blockchains[0].id,
        contractAddress: "0x0000000000000000000000000000000000000000",
        logoUrl:
          "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    prisma.token.upsert({
      where: { contractAddress: "0x1230000000000000000000000000000000000000" },
      update: {},
      create: {
        name: "Polygon",
        symbol: "MATIC",
        decimals: 18,
        blockchainId: blockchains[1].id,
        contractAddress: "0x1230000000000000000000000000000000000000",
        logoUrl:
          "https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
  ]);

  await Promise.all([
    prisma.regionAvailableToken.upsert({
      where: {
        regionId_tokenId: {
          regionId: regions[0].id,
          tokenId: tokens[0].id,
        },
      },
      update: {},
      create: {
        regionId: regions[0].id,
        tokenId: tokens[0].id,
        isActive: true,
        minAmount: 10,
        maxAmount: 1000,
        processingFee: 1.5,
        networkFeeEstimate: 5,
        isDefault: true,
      },
    }),
    prisma.regionAvailableToken.upsert({
      where: {
        regionId_tokenId: {
          regionId: regions[1].id,
          tokenId: tokens[1].id,
        },
      },
      update: {},
      create: {
        regionId: regions[1].id,
        tokenId: tokens[1].id,
        isActive: true,
        minAmount: 10,
        maxAmount: 2000,
        processingFee: 1,
        networkFeeEstimate: 5,
        isDefault: true,
      },
    }),
  ]);

  await Promise.all([
    prisma.regionAvailableToken.upsert({
      where: {
        regionId_tokenId: {
          regionId: regions[0].id,
          tokenId: nativeTokens[0].id,
        },
      },
      update: {},
      create: {
        regionId: regions[0].id,
        tokenId: nativeTokens[0].id,
        isActive: true,
        minAmount: 0.01,
        maxAmount: 10,
        processingFee: 0.001,
        networkFeeEstimate: 0.002,
        isDefault: false,
      },
    }),
    prisma.regionAvailableToken.upsert({
      where: {
        regionId_tokenId: {
          regionId: regions[0].id,
          tokenId: nativeTokens[1].id,
        },
      },
      update: {},
      create: {
        regionId: regions[0].id,
        tokenId: nativeTokens[1].id,
        isActive: true,
        minAmount: 10,
        maxAmount: 10000,
        processingFee: 0.5,
        networkFeeEstimate: 0.1,
        isDefault: false,
      },
    }),
  ]);

  const exchangeSource = await prisma.exchangeSource.upsert({
    where: { name: "CoinGecko" },
    update: {},
    create: {
      name: "CoinGecko",
      description: "CoinGecko API for crypto prices",
      apiEndpoint: "https://api.coingecko.com/api/v3",
      updateInterval: 3600,
      priority: 1,
      isActive: true,
      lastUpdated: new Date(),
    },
  });

  await Promise.all([
    prisma.exchangeRate.create({
      data: {
        fromCurrency: "USDT",
        toCurrency: "IDR",
        rate: 15700,
        sourceProviderId: exchangeSource.id,
        region: "ID",
        markup: 1.5,
        isActive: true,
      },
    }),
    prisma.exchangeRate.create({
      data: {
        fromCurrency: "USDC",
        toCurrency: "SGD",
        rate: 1.35,
        sourceProviderId: exchangeSource.id,
        region: "SG",
        markup: 1,
        isActive: true,
      },
    }),
  ]);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
      update: {},
      create: {
        walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        email: "user1@example.com",
        name: "User One",
        profileImage: "https://i.pravatar.cc/150?u=user1",
        authProvider: "WALLET",
        regionId: regions[0].id,
      },
    }),
    prisma.user.upsert({
      where: { email: "user2@example.com" },
      update: {},
      create: {
        email: "user2@example.com",
        name: "User Two",
        profileImage: "https://i.pravatar.cc/150?u=user2",
        authProvider: "GOOGLE",
        socialId: "google-123456",
        regionId: regions[1].id,
      },
    }),
  ]);

  const vendors = await Promise.all([
    prisma.vendor.upsert({
      where: { name: "vcGamer" },
      update: {},
      create: { name: "vcGamer" },
    }),
    prisma.vendor.upsert({
      where: { name: "DigiVoucher" },
      update: {},
      create: { name: "DigiVoucher" },
    }),
  ]);

  await Promise.all([
    prisma.vendorAPI.upsert({
      where: { id: "vcgamer-api" },
      update: {},
      create: {
        id: "vcgamer-api",
        vendorId: vendors[0].id,
        baseUrl: "https://api.vcgamer.com",
        apiKey: "vcgamer-api-key-123",
        apiSecret: "vcgamer-api-secret-456",
        isActive: true,
      },
    }),
    prisma.vendorAPI.upsert({
      where: { id: "digivoucher-api" },
      update: {},
      create: {
        id: "digivoucher-api",
        vendorId: vendors[1].id,
        baseUrl: "https://api.digivoucher.com",
        apiKey: "digivoucher-api-key-789",
        apiSecret: "digivoucher-api-secret-012",
        isActive: true,
      },
    }),
  ]);

  const categories = await Promise.all([
    prisma.category.upsert({
      where: { name: "Gaming Top Up" },
      update: {},
      create: { name: "Gaming Top Up" },
    }),
    prisma.category.upsert({
      where: { name: "Voucher" },
      update: {},
      create: { name: "Voucher" },
    }),
    prisma.category.upsert({
      where: { name: "Mobile Data" },
      update: {},
      create: { name: "Mobile Data" },
    }),
  ]);

  const vcGamersProducts = await vcGamersAPI.getProducts();
  if (vcGamersProducts.statusCode !== 200 || !vcGamersProducts.data) {
    throw new Error("Failed to fetch products from vcGamers API");
  }

  const productsMap = new Map();
  for (const product of vcGamersProducts.data) {
    const createdProduct = await prisma.product.upsert({
      where: { code: product.key },
      update: {},
      create: {
        name: product.name,
        code: product.key,
        categoryId: categories[0].id,
        description: product.description?.replace(/<[^>]*>/g, "") || "",
        imageUrl: product.image_url,
        isActive: false,
      },
    });
    productsMap.set(product.key, createdProduct);

    const vcGamerVendor = await prisma.vendor.findFirst({
      where: { name: "vcGamer" },
    });

    if (!vcGamerVendor) {
      console.warn(
        "VCGamer vendor not found, skipping variants for this product",
      );
      continue;
    }

    console.log(
      `Fetching variants for product: ${product.name} (${product.key})`,
    );
    const variantsResponse = await vcGamersAPI.getProductVariants(product.key);

    if (
      variantsResponse.statusCode !== 200 ||
      !variantsResponse.data ||
      variantsResponse.data.length === 0
    ) {
      console.warn(`No variants found for product: ${product.key}`);
      continue;
    }

    console.log(
      `Found ${variantsResponse.data.length} variants for product: ${product.name}`,
    );

    for (const variant of variantsResponse.data) {
      try {
        const createdVariant = await prisma.productVariant.upsert({
          where: { sku: variant.key },
          update: {},
          create: {
            name: variant.variation_name,
            sku: variant.key,
            description: `${variant.variation_name} for ${variant.brand_name}`,
            productId: createdProduct.id,
          },
        });

        const sellPrice = Math.round(variant.price * 1.05);

        await prisma.productPrice.upsert({
          where: { id: `price-${variant.key}` },
          update: {},
          create: {
            id: `price-${variant.key}`,
            productVariantId: createdVariant.id,
            vendorId: vcGamerVendor.id,
            priceFromVendor: variant.price,
            realValue: variant.price,
            sellPrice: sellPrice,
            isActive: variant.is_active,
          },
        });

        console.log(
          `Added variant: ${variant.variation_name} (${variant.key})`,
        );
      } catch (error) {
        console.error(`Error creating variant ${variant.key}:`, error);
      }
    }
  }

  const firstProduct = Array.from(productsMap.values())[0];

  const productVariants = await Promise.all([
    prisma.productVariant.upsert({
      where: { sku: "MLBB-86" },
      update: {},
      create: {
        name: "86 Diamonds",
        sku: "MLBB-86",
        description: "86 Diamonds for Mobile Legends",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { sku: "MLBB-172" },
      update: {},
      create: {
        name: "172 Diamonds",
        sku: "MLBB-172",
        description: "172 Diamonds for Mobile Legends",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { sku: "GOGP-10" },
      update: {},
      create: {
        name: "$10 Google Play Card",
        sku: "GOGP-10",
        description: "$10 Google Play Gift Card",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { sku: "GOGP-25" },
      update: {},
      create: {
        name: "$25 Google Play Card",
        sku: "GOGP-25",
        description: "$25 Google Play Gift Card",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { sku: "XLDB1GB2H" },
      update: {},
      create: {
        name: "Data Blue 1 GB 2 Hari",
        sku: "XLDB1GB2H",
        description: "XL Data Blue 1 GB valid for 2 days",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { sku: "XLHR1GB2H" },
      update: {},
      create: {
        name: "HOTROD 1 GB 2 Hari",
        sku: "XLHR1GB2H",
        description: "XL HOTROD 1 GB valid for 2 days",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { sku: "XLHR500M7H" },
      update: {},
      create: {
        name: "HOTROD 500 MB 7 Hari",
        sku: "XLHR500M7H",
        description: "XL HOTROD 500 MB valid for 7 days",
        productId: firstProduct.id,
      },
    }),
  ]);

  await Promise.all([
    prisma.productPrice.upsert({
      where: { id: "product-price-1" },
      update: {},
      create: {
        id: "product-price-1",
        productVariantId: productVariants[0].id,
        vendorId: vendors[0].id,
        realValue: 50000,
        priceFromVendor: 47500,
        sellPrice: 52500,
        isActive: true,
      },
    }),
    prisma.productPrice.upsert({
      where: { id: "product-price-2" },
      update: {},
      create: {
        id: "product-price-2",
        productVariantId: productVariants[1].id,
        vendorId: vendors[0].id,
        realValue: 100000,
        priceFromVendor: 95000,
        sellPrice: 105000,
        isActive: true,
      },
    }),
    prisma.productPrice.upsert({
      where: { id: "product-price-3" },
      update: {},
      create: {
        id: "product-price-3",
        productVariantId: productVariants[2].id,
        vendorId: vendors[1].id,
        realValue: 150000,
        priceFromVendor: 145000,
        sellPrice: 155000,
        isActive: true,
      },
    }),
    prisma.productPrice.upsert({
      where: { id: "product-price-4" },
      update: {},
      create: {
        id: "product-price-4",
        productVariantId: productVariants[3].id,
        vendorId: vendors[1].id,
        realValue: 375000,
        priceFromVendor: 365000,
        sellPrice: 385000,
        isActive: true,
      },
    }),
    prisma.productPrice.upsert({
      where: { id: "product-price-5" },
      update: {},
      create: {
        id: "product-price-5",
        productVariantId: productVariants[4].id,
        vendorId: vendors[0].id,
        realValue: 4710,
        priceFromVendor: 4500,
        sellPrice: 5000,
        isActive: true,
      },
    }),
    prisma.productPrice.upsert({
      where: { id: "product-price-6" },
      update: {},
      create: {
        id: "product-price-6",
        productVariantId: productVariants[5].id,
        vendorId: vendors[0].id,
        realValue: 4728,
        priceFromVendor: 4500,
        sellPrice: 5000,
        isActive: true,
      },
    }),
    prisma.productPrice.upsert({
      where: { id: "product-price-7" },
      update: {},
      create: {
        id: "product-price-7",
        productVariantId: productVariants[6].id,
        vendorId: vendors[0].id,
        realValue: 5395,
        priceFromVendor: 5100,
        sellPrice: 5700,
        isActive: true,
      },
    }),
  ]);

  const transaction = await prisma.transactionHistory.create({
    data: {
      userId: users[0].id,
      tokenId: tokens[0].id,
      type: "PAYMENT",
      status: "COMPLETED",
      amount: 10,
      amountInFiat: 157000,
      fiatCurrency: "IDR",
      txHash:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      senderAddress: users[0].walletAddress,
      recipientAddress: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
    },
  });

  const productPrice = await prisma.productPrice.findFirst({
    where: { productVariantId: productVariants[0].id },
  });

  if (!productPrice) {
    throw new Error(
      "Product price not found for variant: " + productVariants[0].id,
    );
  }

  await prisma.purchase.create({
    data: {
      transactionId: transaction.id,
      productVariantId: productVariants[0].id,
      status: "COMPLETED",
      vendorResponse: JSON.parse(
        '{"success": true, "message": "Top up successful", "transactionId": "VC123456789"}',
      ),
      vendorRefId: "VC123456789",
    },
  });

  await prisma.apiRequestLog.create({
    data: {
      requestId: "req_123456789",
      endpoint: "/api/v1/products",
      method: "GET",
      service: "product-service",
      requestBody: JSON.parse('{"category": "Gaming Top Up"}'),
      responseBody: JSON.parse(
        '{"success": true, "data": [{"id": "1", "name": "Mobile Legends"}]}',
      ),
      statusCode: 200,
      success: true,
      duration: 120,
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      userId: users[0].id,
    },
  });

  console.log("Seed data created successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
