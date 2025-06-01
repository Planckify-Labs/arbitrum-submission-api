import { PrismaClient } from "../../../generated/prisma";

const prisma = new PrismaClient();

async function main() {
  await prisma.apiRequestLog.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.transactionHistory.deleteMany({});
  await prisma.productPrice.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.vendorAPI.deleteMany({});
  await prisma.vendor.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.regionAvailableToken.deleteMany({});
  await prisma.token.deleteMany({});
  await prisma.smartContract.deleteMany({});
  await prisma.contractABI.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.exchangeRate.deleteMany({});
  await prisma.exchangeSource.deleteMany({});
  await prisma.blockchain.deleteMany({});
  await prisma.region.deleteMany({});

  const regions = await Promise.all([
    prisma.region.create({
      data: {
        code: "ID",
        name: "Indonesia",
        currencyCode: "IDR",
        isActive: true,
        taxRate: 11,
        supportEmail: "support-id@takumipay.com",
        supportPhone: "+62123456789",
      },
    }),
    prisma.region.create({
      data: {
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
    prisma.blockchain.create({
      data: {
        name: "Ethereum",
        chainId: 1,
        rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/demo",
        blockExplorer: "https://etherscan.io",
        isEVM: true,
        isActive: true,
      },
    }),
    prisma.blockchain.create({
      data: {
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
    prisma.contractABI.create({
      data: {
        name: "ERC20",
        description: "Standard ERC20 token interface",
        version: "1.0.0",
        abi: JSON.parse(
          `[{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"}]`,
        ),
        isVerified: true,
      },
    }),
    prisma.contractABI.create({
      data: {
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
    prisma.smartContract.create({
      data: {
        name: "USDT Contract",
        blockchainId: blockchains[0].id,
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        abiId: contractABIs[0].id,
        isActive: true,
      },
    }),
    prisma.smartContract.create({
      data: {
        name: "Payment Processor",
        blockchainId: blockchains[1].id,
        address: "0x1234567890123456789012345678901234567890",
        abiId: contractABIs[1].id,
        isActive: true,
      },
    }),
  ]);

  const tokens = await Promise.all([
    prisma.token.create({
      data: {
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
    prisma.token.create({
      data: {
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

  await Promise.all([
    prisma.regionAvailableToken.create({
      data: {
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
    prisma.regionAvailableToken.create({
      data: {
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

  const exchangeSource = await prisma.exchangeSource.create({
    data: {
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
    prisma.user.create({
      data: {
        walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        email: "user1@example.com",
        name: "User One",
        profileImage: "https://i.pravatar.cc/150?u=user1",
        authProvider: "WALLET",
        regionId: regions[0].id,
      },
    }),
    prisma.user.create({
      data: {
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
    prisma.vendor.create({
      data: { name: "vcGamer" },
    }),
    prisma.vendor.create({
      data: { name: "DigiVoucher" },
    }),
  ]);

  await Promise.all([
    prisma.vendorAPI.create({
      data: {
        vendorId: vendors[0].id,
        baseUrl: "https://api.vcgamer.com",
        apiKey: "vcgamer-api-key-123",
        apiSecret: "vcgamer-api-secret-456",
        isActive: true,
      },
    }),
    prisma.vendorAPI.create({
      data: {
        vendorId: vendors[1].id,
        baseUrl: "https://api.digivoucher.com",
        apiKey: "digivoucher-api-key-789",
        apiSecret: "digivoucher-api-secret-012",
        isActive: true,
      },
    }),
  ]);

  const categories = await Promise.all([
    prisma.category.create({
      data: { name: "Gaming Top Up" },
    }),
    prisma.category.create({
      data: { name: "Voucher" },
    }),
  ]);

  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: "Mobile Legends",
        code: "MLBB",
        vendorId: vendors[0].id,
        categoryId: categories[0].id,
      },
    }),
    prisma.product.create({
      data: {
        name: "Voucher Google Play US",
        code: "VOGOP",
        vendorId: vendors[1].id,
        categoryId: categories[1].id,
      },
    }),
  ]);

  await Promise.all([
    prisma.productPrice.create({
      data: {
        productId: products[0].id,
        vendorId: vendors[0].id,
        realValue: 50000,
        priceFromVendor: 47500,
        sellPrice: 52500,
        isActive: true,
      },
    }),
    prisma.productPrice.create({
      data: {
        productId: products[1].id,
        vendorId: vendors[1].id,
        realValue: 100000,
        priceFromVendor: 95000,
        sellPrice: 105000,
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
      amountInIDR: 157000,
      txHash:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      fromAddress: users[0].walletAddress,
      toAddress: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
    },
  });

  const productPrice = await prisma.productPrice.findFirst({
    where: { productId: products[0].id },
  });

  if (!productPrice) {
    throw new Error("Product price not found for product: " + products[0].id);
  }

  await prisma.purchase.create({
    data: {
      transactionId: transaction.id,
      productId: products[0].id,
      productPriceId: productPrice.id,
      status: "COMPLETED",
      customerInfo: JSON.parse('{"gameId": "12345678", "serverID": "9999"}'),
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
