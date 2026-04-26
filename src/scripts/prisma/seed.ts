import {
  PrismaClient,
  ApiKeyType,
  ApiKeyStatus,
  UserRole,
  AuthProvider,
  ChannelKind,
} from "@generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as argon2 from "argon2";
import { DUITKU_CHANNEL_CODES } from "../../payout/duitku-channels";
import { FLIP_CHANNEL_CODES } from "../../payout/flip-channels";

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

const CACHE_DIR = path.join(process.cwd(), "data", "vendor-cache");

const cacheHelpers = {
  ensureCacheDir: (): void => {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  },

  getCacheFilePath: (filename: string): string => {
    return path.join(CACHE_DIR, `${filename}.json`);
  },

  loadFromCache: <T>(filename: string): T | null => {
    try {
      const filePath = cacheHelpers.getCacheFilePath(filename);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        console.log(`📁 Loading cached data from: ${filename}.json`);
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn(`⚠️ Error loading cache file ${filename}:`, error);
    }
    return null;
  },

  saveToCache: <T>(filename: string, data: T): void => {
    try {
      cacheHelpers.ensureCacheDir();
      const filePath = cacheHelpers.getCacheFilePath(filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`💾 Saved data to cache: ${filename}.json`);
    } catch (error) {
      console.error(`❌ Error saving cache file ${filename}:`, error);
    }
  },

  clearCache: (): void => {
    try {
      if (fs.existsSync(CACHE_DIR)) {
        const files = fs.readdirSync(CACHE_DIR);
        for (const file of files) {
          if (file.endsWith(".json")) {
            fs.unlinkSync(path.join(CACHE_DIR, file));
          }
        }
        console.log(`🗑️ Cleared cache directory: ${CACHE_DIR}`);
      }
    } catch (error) {
      console.error(`❌ Error clearing cache:`, error);
    }
  },

  getCacheInfo: (): void => {
    try {
      if (fs.existsSync(CACHE_DIR)) {
        const files = fs
          .readdirSync(CACHE_DIR)
          .filter((f) => f.endsWith(".json"));
        console.log(`📊 Cache directory: ${CACHE_DIR}`);
        console.log(`📁 Cached files: ${files.length}`);
        files.forEach((file) => {
          const filePath = path.join(CACHE_DIR, file);
          const stats = fs.statSync(filePath);
          console.log(
            `   - ${file} (${(stats.size / 1024).toFixed(2)} KB, modified: ${stats.mtime.toISOString()})`,
          );
        });
      } else {
        console.log(`📁 No cache directory found`);
      }
    } catch (error) {
      console.error(`❌ Error reading cache info:`, error);
    }
  },
};

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
    const cachedData = cacheHelpers.loadFromCache<{
      statusCode: number;
      data?: VCGamersProduct[];
    }>("vcgamers-products");

    if (cachedData) {
      console.log("🎯 Using cached VCGamers products data");
      return cachedData;
    }

    console.log("🌐 Fetching VCGamers products from API...");
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

      const result = {
        statusCode: 200,
        data: response?.data,
      };

      cacheHelpers.saveToCache("vcgamers-products", result);

      return result;
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
    const cacheKey = `vcgamers-variants-${brandKey}`;
    const cachedData = cacheHelpers.loadFromCache<{
      statusCode: number;
      data?: VCGamersVariant[];
    }>(cacheKey);

    if (cachedData) {
      console.log(`🎯 Using cached VCGamers variants for ${brandKey}`);
      return cachedData;
    }

    console.log(`🌐 Fetching VCGamers variants for ${brandKey} from API...`);
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

      const result = {
        statusCode: 200,
        data: response?.data,
      };

      cacheHelpers.saveToCache(cacheKey, result);

      return result;
    } catch (err) {
      console.error(`Error fetching VCGamers variants for ${brandKey}:`, err);
      return {
        statusCode: 500,
      };
    }
  },
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function generateApiKey(keyType: string): string {
  // Static API keys for consistent seeding
  const staticKeys = {
    "smart-contract":
      "tk_smart_contract_api_key_12345678901234567890123456789012",
    "mobile-app": "tk_mobile_app_api_key_12345678901234567890123456789012345",
    "web-app": "tk_web_app_api_key_123456789012345678901234567890123456",
    "third-party": "tk_third_party_api_key_12345678901234567890123456789012",
    internal: "tk_internal_api_key_123456789012345678901234567890123456",
    admin: "tk_admin_api_key_1234567890123456789012345678901234567890",
  };

  return (
    staticKeys[keyType] ||
    `tk_${keyType}_static_key_123456789012345678901234567890`
  );
}

async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password);
}

async function seedApiKeys() {
  console.log("🌱 Seeding API keys...");

  const apiKeys = [
    {
      id: "smart-contract-api-key",
      name: "Smart Contract API Key",
      description:
        "API key for smart contract interactions and blockchain operations",
      keyValue: generateApiKey("smart-contract"),
      type: ApiKeyType.SMART_CONTRACT,
      status: ApiKeyStatus.ACTIVE,
      permissions: [
        "blockchains:read",
        "tokens:read",
        "smart-contracts:read",
        "transactions:read",
      ],
      rateLimit: 1000,
      metadata: {
        environment: "production",
        ipRestrictions: [],
        allowedOrigins: ["*"],
      },
    },
    {
      id: "mobile-app-api-key",
      name: "Mobile App API Key",
      description: "API key for TakumiPay mobile application",
      keyValue: generateApiKey("mobile-app"),
      type: ApiKeyType.MOBILE_APP,
      status: ApiKeyStatus.ACTIVE,
      permissions: [
        "products:read",
        "purchases:create",
        "tokens:read",
        "blockchains:read",
        "regions:read",
      ],
      rateLimit: 500,
      metadata: {
        environment: "production",
        platform: "mobile",
        version: "1.0.0",
      },
    },
    {
      id: "web-app-api-key",
      name: "Web App API Key",
      description: "API key for TakumiPay web application",
      keyValue: generateApiKey("web-app"),
      type: ApiKeyType.WEB_APP,
      status: ApiKeyStatus.ACTIVE,
      permissions: [
        "products:read",
        "purchases:create",
        "tokens:read",
        "blockchains:read",
        "smart-contracts:read",
        "regions:read",
      ],
      rateLimit: 300,
      metadata: {
        environment: "production",
        platform: "web",
        allowedOrigins: ["https://takumipay.com", "https://app.takumipay.com"],
      },
    },
    {
      id: "third-party-api-key",
      name: "Third Party Integration",
      description: "API key for third-party integrations and partners",
      keyValue: generateApiKey("third-party"),
      type: ApiKeyType.THIRD_PARTY,
      status: ApiKeyStatus.ACTIVE,
      permissions: ["products:read", "tokens:read", "blockchains:read"],
      rateLimit: 100,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      metadata: {
        partner: "example-partner",
        contact: "partner@example.com",
      },
    },
    {
      id: "internal-api-key",
      name: "Internal Services",
      description: "API key for internal microservices communication",
      keyValue: generateApiKey("internal"),
      type: ApiKeyType.INTERNAL,
      status: ApiKeyStatus.ACTIVE,
      permissions: [
        "products:read",
        "products:write",
        "tokens:read",
        "tokens:write",
        "blockchains:read",
        "blockchains:write",
        "smart-contracts:read",
        "smart-contracts:write",
        "transactions:read",
        "transactions:write",
        "users:read",
        "vendors:read",
      ],
      rateLimit: 2000,
      metadata: {
        service: "internal-microservices",
        environment: "production",
      },
    },
    {
      id: "admin-api-key",
      name: "Admin Dashboard",
      description: "API key for admin dashboard and management operations",
      keyValue: generateApiKey("admin"),
      type: ApiKeyType.ADMIN,
      status: ApiKeyStatus.ACTIVE,
      permissions: ["*"],
      rateLimit: 5000,
      metadata: {
        role: "admin",
        environment: "production",
        ipRestrictions: ["10.0.0.0/8", "192.168.0.0/16"],
      },
    },
  ];

  for (const apiKeyData of apiKeys) {
    try {
      const apiKey = await prisma.apiKey.upsert({
        where: { id: apiKeyData.id },
        update: {
          name: apiKeyData.name,
          description: apiKeyData.description,
          type: apiKeyData.type,
          status: apiKeyData.status,
          permissions: apiKeyData.permissions,
          rateLimit: apiKeyData.rateLimit,
          expiresAt: apiKeyData.expiresAt,
          metadata: apiKeyData.metadata,
        },
        create: apiKeyData,
      });

      console.log(`✅ Created/Updated API key: ${apiKey.name}`);
      console.log(`   Key: ${apiKey.keyValue}`);
      console.log(`   Type: ${apiKey.type}`);
      console.log(`   Rate Limit: ${apiKey.rateLimit} req/min`);
      console.log("");
    } catch (error) {
      console.error(`❌ Error creating API key ${apiKeyData.name}:`, error);
    }
  }

  console.log("🎉 API keys seeding completed!");
}

async function seedAdminUsers() {
  console.log("🌱 Seeding admin users...");

  const adminUsers = [
    {
      id: "admin-user-1",
      email: "admin@takumipay.com",
      password: await hashPassword("Admin123!"),
      name: "System Admin",
      username: "admin",
      authProvider: AuthProvider.ADMIN_CREDENTIALS,
      role: UserRole.ADMIN,
      permissions: {
        users: ["read", "write"],
        products: ["read", "write"],
        transactions: ["read"],
      },
    },
    {
      id: "super-admin-user",
      email: "superadmin@takumipay.com",
      password: await hashPassword("SuperAdmin123!"),
      name: "Super Administrator",
      username: "superadmin",
      authProvider: AuthProvider.ADMIN_CREDENTIALS,
      role: UserRole.SUPER_ADMIN,
      permissions: {
        "*": ["*"],
      },
    },
  ];

  for (const adminData of adminUsers) {
    try {
      const admin = await prisma.user.upsert({
        where: { id: adminData.id },
        update: {
          email: adminData.email,
          password: adminData.password,
          name: adminData.name,
          username: adminData.username,
          role: adminData.role,
          permissions: adminData.permissions,
        },
        create: adminData,
      });

      console.log(`✅ Created/Updated admin user: ${admin.name}`);
      console.log(`   Email: ${admin.email}`);
      console.log(`   Role: ${admin.role}`);
      console.log("");
    } catch (error) {
      console.error(`❌ Error creating admin user ${adminData.name}:`, error);
    }
  }
}

async function main() {
  console.log("🌱 Starting TakumiPay database seeding...");
  console.log("");

  console.log("📊 Cache Status:");
  cacheHelpers.getCacheInfo();
  console.log("");

  // Uncomment the line below to clear cache and force fresh API calls
  // cacheHelpers.clearCache();

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
      update: {
        rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
      },
      create: {
        name: "Ethereum",
        chainId: 1,
        rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://etherscan.io",
        isEVM: true,
        isActive: true,
        isTestnet: false,
      },
    }),
    prisma.blockchain.upsert({
      where: { chainId: 137 },
      update: {
        rpcUrl: "https://polygon-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
      },
      create: {
        name: "Polygon",
        chainId: 137,
        rpcUrl: "https://polygon-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://polygonscan.com",
        isEVM: true,
        isActive: true,
        isTestnet: false,
      },
    }),
    prisma.blockchain.upsert({
      where: { chainId: 11155111 },
      update: {
        rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://sepolia.etherscan.io",
      },
      create: {
        name: "Ethereum Sepolia",
        chainId: 11155111,
        rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://sepolia.etherscan.io",
        isEVM: true,
        isActive: true,
        isTestnet: true,
      },
    }),
    prisma.blockchain.upsert({
      where: { chainId: 84532 },
      update: {
        rpcUrl: "https://base-sepolia.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
      },
      create: {
        name: "Base",
        chainId: 84532,
        rpcUrl: "https://base-sepolia.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://sepolia.basescan.org",
        isEVM: true,
        isActive: true,
        isTestnet: true,
      },
    }),
    prisma.blockchain.upsert({
      where: { chainId: 4202 },
      update: {
        rpcUrl: "https://rpc.sepolia-api.lisk.com",
      },
      create: {
        name: "Lisk",
        chainId: 4202,
        rpcUrl: "https://rpc.sepolia-api.lisk.com",
        blockExplorer: "https://sepolia-blockscout.lisk.com",
        isEVM: true,
        isActive: true,
        isTestnet: true,
      },
    }),
    prisma.blockchain.upsert({
      where: { chainId: 42161 },
      update: {
        rpcUrl: "https://arb-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
      },
      create: {
        name: "Arbitrum",
        chainId: 42161,
        rpcUrl: "https://arb-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://arbiscan.io",
        isEVM: true,
        isActive: true,
        isTestnet: false,
      },
    }),
    // Solana mainnet — no EIP-155 chainId; keyed by chainSlug (cluster name)
    prisma.blockchain.upsert({
      where: { chainSlug: "solana-mainnet" },
      update: {
        rpcUrl: "https://solana-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
      },
      create: {
        name: "Solana",
        chainSlug: "solana-mainnet",
        rpcUrl: "https://solana-mainnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://explorer.solana.com",
        isEVM: false,
        isActive: true,
        isTestnet: false,
      },
    }),
    prisma.blockchain.upsert({
      where: { chainSlug: "solana-devnet" },
      update: {
        rpcUrl: "https://solana-devnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
      },
      create: {
        name: "Solana Devnet",
        chainSlug: "solana-devnet",
        rpcUrl: "https://solana-devnet.g.alchemy.com/v2/Xaofr5_-tu8arlXRJTqqX",
        blockExplorer: "https://explorer.solana.com?cluster=devnet",
        isEVM: false,
        isActive: true,
        isTestnet: true,
      },
    }),
    // Arc Testnet — UMKM USDC payout settlement chain (spec §7 / task 26).
    // Appended at the end of the array so existing `blockchains[N]`
    // references don't shift. `isTestnet` stays true for the life of
    // this row; when Arc mainnet launches (§12 Q1), add a SEPARATE
    // seed entry with the mainnet chainId / rpcUrl / blockExplorer
    // and `isTestnet: false`, plus a paired Token entry at the mainnet
    // USDC contract. To retire this testnet row from user-facing
    // lists, flip `isActive = false` (never `isTestnet`). No schema
    // changes required for the mainnet cut-over.
    prisma.blockchain.upsert({
      where: { chainId: 5042002 },
      update: {
        rpcUrl: "https://rpc.testnet.arc.network",
        blockExplorer: "https://testnet.arcscan.app",
        // Keep Gateway / x402 coordinates in sync on re-seed so drift
        // between envs always converges to the values below (§7.1).
        gatewayWalletContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        gatewayMinterContract: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
        paymasterAddress: null, // Arc: USDC=gas natively, no Paymaster.
        x402DomainName: "GatewayWalletBatched",
        x402DomainVersion: "1",
        x402VerifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        x402FacilitatorUrl:
          "https://gateway-api-testnet.circle.com/gateway/v1/x402/settle",
        // Bundler URL is server-only; Arc doesn't need one (USDC=gas → no
        // UserOps, no bundler). Explicit `null` converges drift on re-seed
        // so an ops-set URL on Arc (which would be a mistake) gets cleared.
        // Other chains intentionally don't appear in this seed's update
        // branch so ops-set URLs SURVIVE a re-seed — task 37 pattern.
        bundlerUrl: null,
      },
      create: {
        name: "Arc Testnet",
        chainId: 5042002,
        rpcUrl: "https://rpc.testnet.arc.network",
        blockExplorer: "https://testnet.arcscan.app",
        isEVM: true,
        isActive: true,
        isTestnet: true,
        // Circle Gateway + x402 coordinates (spec §7.1 Insert 1). Same wallet
        // contract address is reused as the x402 verifying contract on Arc.
        gatewayWalletContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        gatewayMinterContract: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
        paymasterAddress: null, // Arc: USDC=gas natively, no Paymaster.
        x402DomainName: "GatewayWalletBatched",
        x402DomainVersion: "1",
        x402VerifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        x402FacilitatorUrl:
          "https://gateway-api-testnet.circle.com/gateway/v1/x402/settle",
        bundlerUrl: null, // Arc has no bundler; see task 37 + §7.1.
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
    // Payment Processor on Polygon
    prisma.smartContract.upsert({
      where: { id: "smart-contract-payment" },
      update: {},
      create: {
        id: "smart-contract-payment",
        name: "Payment Processor",
        blockchainId: blockchains[1].id, // Polygon
        address: "0x1234567890123456789012345678901234567890",
        abiId: contractABIs[1].id,
        isActive: true,
      },
    }),
    // Payment Processor on Ethereum Sepolia
    prisma.smartContract.upsert({
      where: { id: "smart-contract-payment-sepolia" },
      update: {},
      create: {
        id: "smart-contract-payment-sepolia",
        name: "Payment Processor Sepolia",
        blockchainId: blockchains[2].id, // Ethereum Sepolia
        address: "0xf64BA8EEBD3f9e268bC1989Af0dde77ab2418779",
        abiId: contractABIs[1].id,
        isActive: true,
      },
    }),
    // Payment Processor on Lisk
    prisma.smartContract.upsert({
      where: { id: "smart-contract-payment-lisk" },
      update: {},
      create: {
        id: "smart-contract-payment-lisk",
        name: "Payment Processor",
        blockchainId: blockchains[4].id, // Lisk
        address: "0x39EDabDd022C39B6cfeB3161Ac77c439F325D6a0",
        abiId: contractABIs[1].id,
        isActive: true,
      },
    }),
    // Payment Processor on Base
    prisma.smartContract.upsert({
      where: { id: "smart-contract-payment-base" },
      update: {},
      create: {
        id: "smart-contract-payment-base",
        name: "Payment Processor",
        blockchainId: blockchains[3].id, // Base
        address: "0x479B0843C3e0627f36551660506dEd5b349Fa968",
        abiId: contractABIs[1].id,
        isActive: true,
      },
    }),
    // Payment Processor on Arbitrum
    prisma.smartContract.upsert({
      where: { id: "smart-contract-payment-arbitrum" },
      update: {},
      create: {
        id: "smart-contract-payment-arbitrum",
        name: "Payment Processor",
        blockchainId: blockchains[5].id, // Arbitrum
        address: "0x479B0843C3e0627f36551660506dEd5b349Fa968",
        abiId: contractABIs[1].id,
        isActive: true,
      },
    }),
  ]);

  // ERC20 Stablecoin tokens
  const tokens = await Promise.all([
    // USDC on Ethereum
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[0].id,
          contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        },
      },
      update: {},
      create: {
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        blockchainId: blockchains[0].id, // Ethereum
        contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        logoUrl:
          "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "USD",
      },
    }),
    // USDT on Ethereum
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[0].id,
          contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        },
      },
      update: {},
      create: {
        name: "Tether USD",
        symbol: "USDT",
        decimals: 6,
        blockchainId: blockchains[0].id, // Ethereum
        contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        logoUrl:
          "https://assets.coingecko.com/coins/images/325/small/Tether.png",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "USD",
      },
    }),
    // USDT on Ethereum Sepolia
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[2].id,
          contractAddress: "0xA6ffC6d992F4C6e173836035Aebb8AF3dBBB15cd",
        },
      },
      update: {},
      create: {
        name: "Tether USD",
        symbol: "USDT",
        decimals: 6,
        blockchainId: blockchains[2].id, // Ethereum Sepolia
        contractAddress: "0xA6ffC6d992F4C6e173836035Aebb8AF3dBBB15cd",
        logoUrl: "https://tether.to/images/logoCircle.svg",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "USD",
      },
    }),
    // IDRX on Lisk
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[4].id,
          contractAddress: "0x53080Db01Ca5C60A36B6eE01436C2f300a31d16A",
        },
      },
      update: {},
      create: {
        name: "IDRX Stablecoin",
        symbol: "IDRX",
        decimals: 2,
        blockchainId: blockchains[4].id, // Lisk
        contractAddress: "0x53080Db01Ca5C60A36B6eE01436C2f300a31d16A",
        logoUrl:
          "https://pbs.twimg.com/profile_images/1951205358447501313/7OQgISvo_400x400.jpg",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "IDR",
      },
    }),
    // IDRX on Base
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[3].id,
          contractAddress: "0x1aC593085Fa34c651E805085da4b2cabAC676F99",
        },
      },
      update: {},
      create: {
        name: "IDRX Stablecoin",
        symbol: "IDRX",
        decimals: 2,
        blockchainId: blockchains[3].id, // Base
        contractAddress: "0x1aC593085Fa34c651E805085da4b2cabAC676F99",
        logoUrl:
          "https://pbs.twimg.com/profile_images/1951205358447501313/7OQgISvo_400x400.jpg",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "IDR",
      },
    }),
    // USDT on Arbitrum
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[5].id,
          contractAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        },
      },
      update: {},
      create: {
        name: "Tether USD",
        symbol: "USDT",
        decimals: 6,
        blockchainId: blockchains[5].id, // Arbitrum
        contractAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        logoUrl:
          "https://assets.coingecko.com/coins/images/325/small/Tether.png",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "USD",
      },
    }),
  ]);

  // Native currency tokens
  await Promise.all([
    // ETH on Ethereum
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[0].id,
          contractAddress: "0x0000000000000000000000000000000000000000",
        },
      },
      update: {},
      create: {
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        blockchainId: blockchains[0].id, // Ethereum
        contractAddress: "0x0000000000000000000000000000000000000000",
        logoUrl:
          "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // MATIC on Polygon
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[1].id,
          contractAddress: "0x1230000000000000000000000000000000000000",
        },
      },
      update: {},
      create: {
        name: "Polygon",
        symbol: "MATIC",
        decimals: 18,
        blockchainId: blockchains[1].id, // Polygon
        contractAddress: "0x1230000000000000000000000000000000000000",
        logoUrl:
          "https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // ETH on Base
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[3].id,
          contractAddress: "0x0000000000000000000000000000000000000001",
        },
      },
      update: {},
      create: {
        name: "Base",
        symbol: "ETH",
        decimals: 18,
        blockchainId: blockchains[3].id, // Base
        contractAddress: "0x0000000000000000000000000000000000000001",
        logoUrl: "https://avatars.githubusercontent.com/u/108554348?s=200&v=4",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // Sepolia Ether on Ethereum Sepolia
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[2].id,
          contractAddress: "0x0000000000000000000000000000000000000002",
        },
      },
      update: {
        symbol: "ETH",
      },
      create: {
        name: "Sepolia Ether",
        symbol: "ETH",
        decimals: 18,
        blockchainId: blockchains[2].id, // Ethereum Sepolia
        contractAddress: "0x0000000000000000000000000000000000000002",
        logoUrl:
          "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // ETH on Lisk
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[4].id,
          contractAddress: "0x0000000000000000000000000000000000000003",
        },
      },
      update: {},
      create: {
        name: "Lisk",
        symbol: "ETH",
        decimals: 18,
        blockchainId: blockchains[4].id, // Lisk
        contractAddress: "0x0000000000000000000000000000000000000003",
        logoUrl: "https://avatars.githubusercontent.com/u/16600915?s=200&v=4",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // ETH on Arbitrum
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[5].id,
          contractAddress: "0x0000000000000000000000000000000000000004",
        },
      },
      update: {
        logoUrl: "https://cryptologos.cc/logos/arbitrum-arb-logo.png?v=040",
      },
      create: {
        name: "Arbitrum",
        symbol: "ETH",
        decimals: 18,
        blockchainId: blockchains[5].id, // Arbitrum
        contractAddress: "0x0000000000000000000000000000000000000004",
        logoUrl: "https://cryptologos.cc/logos/arbitrum-arb-logo.png?v=040",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // SOL on Solana mainnet — identified by the canonical Wrapped SOL mint
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[6].id,
          contractAddress: "So11111111111111111111111111111111111111112",
        },
      },
      update: {},
      create: {
        name: "Solana",
        symbol: "SOL",
        decimals: 9,
        blockchainId: blockchains[6].id, // Solana mainnet
        contractAddress: "So11111111111111111111111111111111111111112",
        logoUrl:
          "https://assets.coingecko.com/coins/images/4128/small/solana.png",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // SOL on Solana Devnet — same canonical Wrapped SOL mint across clusters
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[7].id,
          contractAddress: "So11111111111111111111111111111111111111112",
        },
      },
      update: {},
      create: {
        name: "Solana Devnet",
        symbol: "SOL",
        decimals: 9,
        blockchainId: blockchains[7].id, // Solana Devnet
        contractAddress: "So11111111111111111111111111111111111111112",
        logoUrl:
          "https://assets.coingecko.com/coins/images/4128/small/solana.png",
        isStablecoin: false,
        isNativeCurrency: true,
        isActive: true,
      },
    }),
    // Mock USDC on Solana Devnet — deployed via devnet-setup.ts for merchant payment testing
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[7].id,
          contractAddress: "4qFejVSp46Q4SZCGDrXbkFJC1qw5uo1JBnbXLnKZurey",
        },
      },
      update: {},
      create: {
        name: "USD Coin (Devnet)",
        symbol: "USDC",
        decimals: 6,
        blockchainId: blockchains[7].id, // Solana Devnet
        contractAddress: "4qFejVSp46Q4SZCGDrXbkFJC1qw5uo1JBnbXLnKZurey",
        logoUrl:
          "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "USD",
      },
    }),
    // USDC-SPL on Solana Mainnet — canonical Circle USDC mint
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[6].id,
          contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
      },
      update: {},
      create: {
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        blockchainId: blockchains[6].id, // Solana Mainnet
        contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        logoUrl:
          "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
        isStablecoin: true,
        isActive: true,
        peggedCurrency: "USD",
      },
    }),
    // USDC on Arc Testnet — spec §7, task 26. On Arc USDC is the
    // native gas token; decimals=18 matches the native-gas view used
    // by the existing EVM balance/transfer pipeline (no dual-view
    // handling needed). Both isStablecoin AND isNativeCurrency are
    // true — Arc is the first chain in this project where that combo
    // applies.
    prisma.token.upsert({
      where: {
        blockchainId_contractAddress: {
          blockchainId: blockchains[8].id, // Arc Testnet
          contractAddress: "0x3600000000000000000000000000000000000000",
        },
      },
      update: {
        decimals: 18,
      },
      create: {
        name: "USD Coin",
        symbol: "USDC",
        decimals: 18,
        blockchainId: blockchains[8].id, // Arc Testnet
        contractAddress: "0x3600000000000000000000000000000000000000",
        logoUrl:
          "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
        isStablecoin: true,
        isNativeCurrency: true,
        isActive: true,
        peggedCurrency: "USD",
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

  const seedExchangeRates: Array<{
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    region: string;
    markup: number;
  }> = [
    { fromCurrency: "USDT", toCurrency: "IDR", rate: 15700, region: "ID", markup: 1.5 },
    { fromCurrency: "USDC", toCurrency: "SGD", rate: 1.35, region: "SG", markup: 1 },
    { fromCurrency: "IDRX", toCurrency: "IDR", rate: 1, region: "ID", markup: 0 },
    // UMKM USDC → IDR payout (spec §6.6 FX prerequisites, task 26).
    // Rate ≈ mid-market early-2026 (USDC ≈ USD, USD/IDR ~16,200-16,300).
    // `markup: 1.5` absorbs drift per §12 Q10 — no live FX cron in v1,
    // ops re-runs `pnpm prisma db seed` to tune. TODO: wire a scheduled
    // refresh (Wise / OpenExchangeRates / Chainlink) post-v1.
    { fromCurrency: "USDC", toCurrency: "IDR", rate: 16234.5, region: "ID", markup: 1.5 },
  ];

  await Promise.all(
    seedExchangeRates.map(async (r) => {
      const existing = await prisma.exchangeRate.findFirst({
        where: {
          fromCurrency: r.fromCurrency,
          toCurrency: r.toCurrency,
          region: r.region,
          sourceProviderId: exchangeSource.id,
          isActive: true,
        },
      });
      if (existing) return;
      await prisma.exchangeRate.create({
        data: {
          fromCurrency: r.fromCurrency,
          toCurrency: r.toCurrency,
          rate: r.rate,
          sourceProviderId: exchangeSource.id,
          region: r.region,
          markup: r.markup,
          isActive: true,
        },
      });
    }),
  );

  // Canonical payout channels (spec §6.6 `channels`, task 26).
  // Composite PK = (channelCode, country). Upsert → idempotent, ops
  // re-runs `pnpm prisma db seed` to tune fees/limits. country-keyed
  // (not namespace-keyed) so future MY/TH/VN expansion is data-only.
  // Per-provider codes + fees live in `ProviderChannel` (two rows per
  // channel: xendit + duitku). Canonical `Channel` rows hold only the
  // merchant-facing catalog (label, kind, icon, priority).
  // DUITKU_CHANNEL_CODES below mirrors research §2.7 (duitku_payout_provider_research.md).
  // Duitku wire-codes come from `DUITKU_CHANNEL_CODES` (src/payout/duitku-channels.ts)
  // — single source of truth for both the seed and any future admin tooling.
  // Channels without a Duitku mapping just skip the duitku ProviderChannel row.
  const seedChannels: Array<{
    channelCode: string;
    country: string;
    label: string;
    kind: ChannelKind;
    accountFormat: string;
    priority: number;
    iconUrl: string | null;
    minAmountIdr: number;
    maxAmountIdr: number;
    feeIdr: number;
  }> = [
    { channelCode: "GOPAY",     country: "ID", label: "GoPay",     kind: ChannelKind.ewallet, accountFormat: "phone_id",  priority: 10, iconUrl: "https://assets.takumipay.com/channels/gopay.png",     minAmountIdr: 10_000, maxAmountIdr: 20_000_000, feeIdr: 2500 },
    { channelCode: "OVO",       country: "ID", label: "OVO",       kind: ChannelKind.ewallet, accountFormat: "phone_id",  priority: 11, iconUrl: "https://assets.takumipay.com/channels/ovo.png",       minAmountIdr: 10_000, maxAmountIdr: 10_000_000, feeIdr: 2500 },
    { channelCode: "DANA",      country: "ID", label: "DANA",      kind: ChannelKind.ewallet, accountFormat: "phone_id",  priority: 12, iconUrl: "https://assets.takumipay.com/channels/dana.png",      minAmountIdr: 10_000, maxAmountIdr: 10_000_000, feeIdr: 2500 },
    { channelCode: "SHOPEEPAY", country: "ID", label: "ShopeePay", kind: ChannelKind.ewallet, accountFormat: "phone_id",  priority: 13, iconUrl: "https://assets.takumipay.com/channels/shopeepay.png", minAmountIdr: 10_000, maxAmountIdr: 10_000_000, feeIdr: 2500 },
    { channelCode: "BCA",       country: "ID", label: "BCA",       kind: ChannelKind.bank,    accountFormat: "digits:10", priority: 20, iconUrl: "https://assets.takumipay.com/channels/bca.png",       minAmountIdr: 10_000, maxAmountIdr: 50_000_000, feeIdr: 5000 },
    { channelCode: "MANDIRI",   country: "ID", label: "Mandiri",   kind: ChannelKind.bank,    accountFormat: "digits:13", priority: 21, iconUrl: "https://assets.takumipay.com/channels/mandiri.png",   minAmountIdr: 10_000, maxAmountIdr: 50_000_000, feeIdr: 5000 },
    { channelCode: "BNI",       country: "ID", label: "BNI",       kind: ChannelKind.bank,    accountFormat: "digits:10", priority: 22, iconUrl: "https://assets.takumipay.com/channels/bni.png",       minAmountIdr: 10_000, maxAmountIdr: 50_000_000, feeIdr: 5000 },
    { channelCode: "BRI",       country: "ID", label: "BRI",       kind: ChannelKind.bank,    accountFormat: "digits:15", priority: 23, iconUrl: "https://assets.takumipay.com/channels/bri.png",       minAmountIdr: 10_000, maxAmountIdr: 50_000_000, feeIdr: 5000 },
  ];

  for (const ch of seedChannels) {
    await prisma.channel.upsert({
      where: {
        channelCode_country: { channelCode: ch.channelCode, country: ch.country },
      },
      update: {
        label: ch.label,
        kind: ch.kind,
        accountFormat: ch.accountFormat,
        priority: ch.priority,
        iconUrl: ch.iconUrl,
        isActive: true,
      },
      create: {
        channelCode: ch.channelCode,
        country: ch.country,
        label: ch.label,
        kind: ch.kind,
        accountFormat: ch.accountFormat,
        priority: ch.priority,
        iconUrl: ch.iconUrl,
        isActive: true,
      },
    });

    // Xendit provider mapping — `providerChannelCode` == canonical today.
    await prisma.providerChannel.upsert({
      where: {
        channelCode_country_provider: {
          channelCode: ch.channelCode,
          country: ch.country,
          provider: "xendit",
        },
      },
      update: {
        providerChannelCode: ch.channelCode,
        minAmountIdr: ch.minAmountIdr,
        maxAmountIdr: ch.maxAmountIdr,
        feeIdr: ch.feeIdr,
        isActive: true,
      },
      create: {
        channelCode: ch.channelCode,
        country: ch.country,
        provider: "xendit",
        providerChannelCode: ch.channelCode,
        minAmountIdr: ch.minAmountIdr,
        maxAmountIdr: ch.maxAmountIdr,
        feeIdr: ch.feeIdr,
        isActive: true,
      },
    });

    // Duitku provider mapping — wire-code resolved from the shared
    // `DUITKU_CHANNEL_CODES` table (research §2.7). Channels without a
    // Duitku equivalent (e.g. future non-IDR channels) just skip.
    // Dev-default fees mirror Xendit; ops can tune in prod via admin tooling.
    const duitkuCode = DUITKU_CHANNEL_CODES[ch.channelCode];
    if (duitkuCode) {
      await prisma.providerChannel.upsert({
        where: {
          channelCode_country_provider: {
            channelCode: ch.channelCode,
            country: ch.country,
            provider: "duitku",
          },
        },
        update: {
          providerChannelCode: duitkuCode,
          minAmountIdr: ch.minAmountIdr,
          maxAmountIdr: ch.maxAmountIdr,
          feeIdr: ch.feeIdr,
          isActive: true,
        },
        create: {
          channelCode: ch.channelCode,
          country: ch.country,
          provider: "duitku",
          providerChannelCode: duitkuCode,
          minAmountIdr: ch.minAmountIdr,
          maxAmountIdr: ch.maxAmountIdr,
          feeIdr: ch.feeIdr,
          isActive: true,
        },
      });
    } else {
      // Task 11 rule: skip with a warn when no Duitku mapping exists —
      // don't implicitly create a stub.
      console.warn(
        `seed: no Duitku channel code for canonical "${ch.channelCode}"; skipping duitku ProviderChannel row.`,
      );
    }

    // Flip provider mapping — wire-code resolved from the shared
    // `FLIP_CHANNEL_CODES` table (flip_payout_provider_spec.md §4.7).
    const flipCode = FLIP_CHANNEL_CODES[ch.channelCode];
    if (flipCode) {
      await prisma.providerChannel.upsert({
        where: {
          channelCode_country_provider: {
            channelCode: ch.channelCode,
            country: ch.country,
            provider: "flip",
          },
        },
        update: {
          providerChannelCode: flipCode,
          minAmountIdr: ch.minAmountIdr,
          maxAmountIdr: ch.maxAmountIdr,
          feeIdr: ch.feeIdr,
          isActive: true,
        },
        create: {
          channelCode: ch.channelCode,
          country: ch.country,
          provider: "flip",
          providerChannelCode: flipCode,
          minAmountIdr: ch.minAmountIdr,
          maxAmountIdr: ch.maxAmountIdr,
          feeIdr: ch.feeIdr,
          isActive: true,
        },
      });
    } else {
      console.warn(
        `seed: no Flip channel code for canonical "${ch.channelCode}"; skipping flip ProviderChannel row.`,
      );
    }
  }

  const users = await Promise.all([
    prisma.user.upsert({
      where: { walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
      update: {
        role: UserRole.USER,
      },
      create: {
        walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        email: "user1@example.com",
        name: "User One",
        profileImage: "https://i.pravatar.cc/150?u=user1",
        authProvider: AuthProvider.WALLET,
        regionId: regions[0].id,
        role: UserRole.USER,
      },
    }),
    prisma.user.upsert({
      where: { email: "user2@example.com" },
      update: {
        role: UserRole.USER,
      },
      create: {
        email: "user2@example.com",
        name: "User Two",
        profileImage: "https://i.pravatar.cc/150?u=user2",
        authProvider: AuthProvider.GOOGLE,
        socialId: "google-123456",
        regionId: regions[1].id,
        role: UserRole.USER,
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
        vendorId: vendors[0].id,
        baseUrl: "https://mitra-api.vcgamers.com",
        apiKey:
          "4d5855d626b5558e155ce6eddb7f370e7749f2e6fee891556e879d46cadb276e8c7a25a4b841efb5972e6d3d9aa2f201bb4d",
        apiSecret: "8aa3a704a9c2af43c636df2e59828777",
        isActive: true,
      },
    }),
    prisma.vendorAPI.upsert({
      where: { id: "digivoucher-api" },
      update: {},
      create: {
        vendorId: vendors[1].id,
        baseUrl: "https://api.digivoucher.com",
        apiKey: "digivoucher-api-key-789",
        apiSecret: "digivoucher-api-secret-012",
        isActive: true,
      },
    }),
  ]);

  const CATEGORY = {
    GAMING: "Gaming",
    PULSA_DATA: "Pulsa & Data Package",
    WITHDRAW: "Withdraw",
    SOCIALS: "Socials",
    RECHARGE: "Recharge",
    UTILITIES: "Utilities",
    STREAMING: "Streaming",
  } as const;

  const PRODUCT_CODE_TO_CATEGORY: Record<
    string,
    (typeof CATEGORY)[keyof typeof CATEGORY]
  > = {
    OVO: CATEGORY.WITHDRAW,
    LAJ: CATEGORY.WITHDRAW,
    GoPay: CATEGORY.WITHDRAW,
    DNA: CATEGORY.WITHDRAW,

    XL: CATEGORY.PULSA_DATA,
    AXIS: CATEGORY.PULSA_DATA,
    BYU: CATEGORY.PULSA_DATA,
    PSATL: CATEGORY.PULSA_DATA,
    TRI: CATEGORY.PULSA_DATA,
    PSAIN: CATEGORY.PULSA_DATA,
    SMARTFREN: CATEGORY.PULSA_DATA,

    GFX: CATEGORY.STREAMING,
    VOBST: CATEGORY.STREAMING,
    WETVID: CATEGORY.STREAMING,
    WETV: CATEGORY.STREAMING,
    IQIY: CATEGORY.STREAMING,
    VHBOGO: CATEGORY.STREAMING,
    SPO: CATEGORY.STREAMING,

    BLV: CATEGORY.SOCIALS,
    BMD: CATEGORY.SOCIALS,
    "DazzLive-C": CATEGORY.SOCIALS,
    LIVU: CATEGORY.SOCIALS,
    PPYLV: CATEGORY.SOCIALS,
    VOCBIGO: CATEGORY.SOCIALS,
    firy: CATEGORY.SOCIALS,
    mico: CATEGORY.SOCIALS,
    sugo: CATEGORY.SOCIALS,
    SCVCP: CATEGORY.SOCIALS,
    IMO: CATEGORY.SOCIALS,
    MALV: CATEGORY.SOCIALS,
    MIGO: CATEGORY.SOCIALS,
    TGL: CATEGORY.SOCIALS,
    YLG: CATEGORY.SOCIALS,

    tvpn: CATEGORY.UTILITIES,
    PLN: CATEGORY.RECHARGE,
  };

  const categoryRecords = await Promise.all(
    Object.values(CATEGORY).map((name) =>
      prisma.category.upsert({
        where: { name },
        update: {},
        create: {
          name,
          categoryType: "MAINCATEGORY",
          isActive: CATEGORY[name] === "Withdraw" ? false : true,
        },
      }),
    ),
  );

  const categoriesByName = new Map(categoryRecords.map((c) => [c.name, c]));

  console.log("🎮 Fetching VCGamers products...");
  const vcGamersProducts = await vcGamersAPI.getProducts();
  if (vcGamersProducts.statusCode !== 200 || !vcGamersProducts.data) {
    throw new Error("Failed to fetch products from vcGamers API");
  }
  console.log(
    `✅ Retrieved ${vcGamersProducts.data.length} products from VCGamers`,
  );
  console.log("");

  const productsMap = new Map();
  for (const product of vcGamersProducts.data) {
    const mappedCategoryName = PRODUCT_CODE_TO_CATEGORY[product.key];
    const fallbackCategoryId = categoriesByName.get(CATEGORY.GAMING)!.id;
    const mappedCategoryId = mappedCategoryName
      ? (categoriesByName.get(mappedCategoryName)?.id ?? fallbackCategoryId)
      : fallbackCategoryId;
    const createdProduct = await prisma.product.upsert({
      where: { code: product.key },
      update: {},
      create: {
        name: product.name,
        code: product.key,
        categoryId: mappedCategoryId,
        description: product.description?.replace(/<[^>]*>/g, "") || "",
        imageUrl: product.image_url,
        isActive: true,
        isVoucher: product.is_voucher,
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

    if (
      product.forms &&
      Array.isArray(product.forms) &&
      product.forms.length > 0
    ) {
      await prisma.productInputField.upsert({
        where: {
          id: `input-field-${product.key}`,
        },
        update: {
          forms: product.forms,
        },
        create: {
          id: `input-field-${product.key}`,
          productId: createdProduct.id,
          forms: product.forms,
        },
      });

      console.log(`Added input fields for product: ${product.name}`);
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
          where: { variantCode: variant.key },
          update: {},
          create: {
            name: variant.variation_name,
            variantCode: variant.key,
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
            currency: "IDR",
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
      where: { variantCode: "MLBB-86" },
      update: {},
      create: {
        name: "86 Diamonds",
        variantCode: "MLBB-86",
        description: "86 Diamonds for Mobile Legends",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { variantCode: "MLBB-172" },
      update: {},
      create: {
        name: "172 Diamonds",
        variantCode: "MLBB-172",
        description: "172 Diamonds for Mobile Legends",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { variantCode: "GOGP-10" },
      update: {},
      create: {
        name: "$10 Google Play Card",
        variantCode: "GOGP-10",
        description: "$10 Google Play Gift Card",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { variantCode: "GOGP-25" },
      update: {},
      create: {
        name: "$25 Google Play Card",
        variantCode: "GOGP-25",
        description: "$25 Google Play Gift Card",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { variantCode: "XLDB1GB2H" },
      update: {},
      create: {
        name: "Data Blue 1 GB 2 Hari",
        variantCode: "XLDB1GB2H",
        description: "XL Data Blue 1 GB valid for 2 days",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { variantCode: "XLHR1GB2H" },
      update: {},
      create: {
        name: "HOTROD 1 GB 2 Hari",
        variantCode: "XLHR1GB2H",
        description: "XL HOTROD 1 GB valid for 2 days",
        productId: firstProduct.id,
      },
    }),
    prisma.productVariant.upsert({
      where: { variantCode: "XLHR500M7H" },
      update: {},
      create: {
        name: "HOTROD 500 MB 7 Hari",
        variantCode: "XLHR500M7H",
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
        currency: "IDR",
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
        currency: "IDR",
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
        currency: "IDR",
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
        currency: "IDR",
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
        currency: "IDR",
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
        currency: "IDR",
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
        currency: "IDR",
      },
    }),
  ]);

  const seedTxHash =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const existingSeedTransaction = await prisma.transactionHistory.findFirst({
    where: { txHash: seedTxHash },
  });

  if (!existingSeedTransaction) {
    const transaction = await prisma.transactionHistory.create({
      data: {
        userId: users[0].id,
        tokenId: tokens[0].id,
        type: "PAYMENT",
        status: "COMPLETED",
        amount: 10,
        amountInFiat: 157000,
        fiatCurrency: "IDR",
        txHash: seedTxHash,
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

    const bookingOrder = await prisma.bookingOrder.create({
      data: {
        walletAddress: users[0].walletAddress!,
        productVariantId: productVariants[0].id,
        productPriceId: productPrice.id,
        customerInfo: {
          userId: "12345",
          server: "Asia",
        },
        payment: {
          amount: 10,
          tokenAddress: tokens[0].contractAddress,
          chainId: 1,
        },
        exchangeRate: {
          rate: 15700,
          fromCurrency: "ETH",
          toCurrency: "IDR",
        },
        status: "EXECUTED",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await prisma.purchase.create({
      data: {
        transactionId: transaction.id,
        transactionCreatedAt: transaction.createdAt,
        productVariantId: productVariants[0].id,
        bookingOrderId: bookingOrder.id,
        status: "COMPLETED",
        vendorResponse: JSON.parse(
          '{"success": true, "message": "Top up successful", "transactionId": "VC123456789"}',
        ),
        vendorRefId: "VC123456789",
      },
    });
  }

  console.log("🌱 Seeding Dapp categories...");
  const dappCategories = await Promise.all([
    prisma.dappCategory.upsert({
      where: { name: "DEX" },
      update: {},
      create: {
        name: "DEX",
        description: "Decentralized Exchanges",
        iconUrl: "https://example.com/icons/dex.svg",
        isActive: true,
      },
    }),
    prisma.dappCategory.upsert({
      where: { name: "DeFi" },
      update: {},
      create: {
        name: "DeFi",
        description: "Decentralized Finance applications",
        iconUrl: "https://example.com/icons/defi.svg",
        isActive: true,
      },
    }),
    prisma.dappCategory.upsert({
      where: { name: "Gaming" },
      update: {},
      create: {
        name: "Gaming",
        description: "Blockchain gaming and NFT games",
        iconUrl: "https://example.com/icons/gaming.svg",
        isActive: true,
      },
    }),
  ]);

  console.log(`✅ Created ${dappCategories.length} dapp categories`);

  console.log("🌱 Seeding Dapps...");
  const dapps = await Promise.all([
    prisma.dapp.upsert({
      where: { id: "uniswap-dapp" },
      update: {},
      create: {
        id: "uniswap-dapp",
        name: "Uniswap",
        description: "The largest decentralized exchange on Ethereum",
        logoUrl: "https://app.uniswap.org/favicon.ico",
        websiteUrl: "https://app.uniswap.org",
        categoryId: dappCategories[0].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        bgColor: "#FF007A",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "sushiswap-dapp" },
      update: {},
      create: {
        id: "sushiswap-dapp",
        name: "SushiSwap",
        description: "Community-driven decentralized exchange",
        logoUrl: "https://sushi.com/favicon.ico",
        websiteUrl: "https://sushi.com",
        categoryId: dappCategories[0].id,
        isPopular: true,
        isSponsor: false,
        isHighlight: true,
        isActive: true,
        bgColor: "#0E0F23",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "pancakeswap-dapp" },
      update: {},
      create: {
        id: "pancakeswap-dapp",
        name: "PancakeSwap",
        description: "The most popular DEX on BNB Smart Chain",
        logoUrl: "https://pancakeswap.finance/favicon.ico",
        websiteUrl: "https://pancakeswap.finance",
        categoryId: dappCategories[0].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: false,
        isActive: true,
        bgColor: "#1FC7D4",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "1inch-dapp" },
      update: {},
      create: {
        id: "1inch-dapp",
        name: "1inch",
        description: "DEX aggregator with the best rates",
        logoUrl: "https://1inch.io/favicon.ico",
        websiteUrl: "https://1inch.io",
        categoryId: dappCategories[0].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        bgColor: "#1B2A4E",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "curve-dapp" },
      update: {},
      create: {
        id: "curve-dapp",
        name: "Curve Finance",
        description: "Exchange liquidity pool for stablecoins",
        logoUrl: "https://curve.fi/favicon.ico",
        websiteUrl: "https://curve.fi",
        categoryId: dappCategories[0].id,
        isPopular: true,
        isSponsor: false,
        isHighlight: false,
        isActive: true,
        bgColor: "#40E0D0",
      },
    }),

    prisma.dapp.upsert({
      where: { id: "compound-dapp" },
      update: {},
      create: {
        id: "compound-dapp",
        name: "Compound",
        description: "Algorithmic money markets protocol",
        logoUrl: "https://compound.finance/favicon.ico",
        websiteUrl: "https://compound.finance",
        categoryId: dappCategories[1].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        bgColor: "#00D395",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "aave-dapp" },
      update: {},
      create: {
        id: "aave-dapp",
        name: "Aave",
        description: "Open source and non-custodial liquidity protocol",
        logoUrl: "https://aave.com/favicon.ico",
        websiteUrl: "https://aave.com",
        categoryId: dappCategories[1].id,
        isPopular: true,
        isSponsor: false,
        isHighlight: true,
        isActive: true,
        bgColor: "#B6509E",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "makerdao-dapp" },
      update: {},
      create: {
        id: "makerdao-dapp",
        name: "MakerDAO",
        description: "Decentralized credit platform on Ethereum",
        logoUrl: "https://makerdao.com/favicon.ico",
        websiteUrl: "https://makerdao.com",
        categoryId: dappCategories[1].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: false,
        isActive: true,
        bgColor: "#1AAB9B",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "yearn-dapp" },
      update: {},
      create: {
        id: "yearn-dapp",
        name: "Yearn Finance",
        description: "Yield farming made simple",
        logoUrl: "https://yearn.finance/favicon.ico",
        websiteUrl: "https://yearn.finance",
        categoryId: dappCategories[1].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        bgColor: "#0657F9",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "synthetix-dapp" },
      update: {},
      create: {
        id: "synthetix-dapp",
        name: "Synthetix",
        description: "Derivatives liquidity protocol",
        logoUrl: "https://synthetix.io/favicon.ico",
        websiteUrl: "https://synthetix.io",
        categoryId: dappCategories[1].id,
        isPopular: true,
        isSponsor: false,
        isHighlight: false,
        isActive: true,
        bgColor: "#00D4FF",
      },
    }),

    prisma.dapp.upsert({
      where: { id: "axie-infinity-dapp" },
      update: {},
      create: {
        id: "axie-infinity-dapp",
        name: "Axie Infinity",
        description: "Play-to-earn blockchain game with cute creatures",
        logoUrl: "https://axieinfinity.com/favicon.ico",
        websiteUrl: "https://axieinfinity.com",
        categoryId: dappCategories[2].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        bgColor: "#1E3A8A",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "decentraland-dapp" },
      update: {},
      create: {
        id: "decentraland-dapp",
        name: "Decentraland",
        description: "Virtual reality platform powered by Ethereum",
        logoUrl: "https://decentraland.org/favicon.ico",
        websiteUrl: "https://decentraland.org",
        categoryId: dappCategories[2].id,
        isPopular: true,
        isSponsor: false,
        isHighlight: true,
        isActive: true,
        bgColor: "#FF2D55",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "sandbox-dapp" },
      update: {},
      create: {
        id: "sandbox-dapp",
        name: "The Sandbox",
        description: "Virtual world where players can build and monetize",
        logoUrl: "https://sandbox.game/favicon.ico",
        websiteUrl: "https://sandbox.game",
        categoryId: dappCategories[2].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: false,
        isActive: true,
        bgColor: "#00ADEF",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "splinterlands-dapp" },
      update: {},
      create: {
        id: "splinterlands-dapp",
        name: "Splinterlands",
        description: "Digital trading card game on blockchain",
        logoUrl: "https://splinterlands.com/favicon.ico",
        websiteUrl: "https://splinterlands.com",
        categoryId: dappCategories[2].id,
        isPopular: true,
        isSponsor: true,
        isHighlight: true,
        isActive: true,
        bgColor: "#8B4513",
      },
    }),
    prisma.dapp.upsert({
      where: { id: "gods-unchained-dapp" },
      update: {},
      create: {
        id: "gods-unchained-dapp",
        name: "Gods Unchained",
        description: "Free-to-play tactical card game",
        logoUrl: "https://godsunchained.com/favicon.ico",
        websiteUrl: "https://godsunchained.com",
        categoryId: dappCategories[2].id,
        isPopular: true,
        isSponsor: false,
        isHighlight: false,
        isActive: true,
        bgColor: "#1A1A2E",
      },
    }),
  ]);

  console.log(`✅ Created ${dapps.length} dapps`);

  console.log("🌱 Seeding user dapp favorites...");
  const userDappFavorites = await Promise.all([
    prisma.userDappFavorite.upsert({
      where: {
        userId_dappId: {
          userId: users[0].id,
          dappId: dapps[0].id,
        },
      },
      update: {},
      create: {
        userId: users[0].id,
        dappId: dapps[0].id,
      },
    }),
    prisma.userDappFavorite.upsert({
      where: {
        userId_dappId: {
          userId: users[0].id,
          dappId: dapps[1].id,
        },
      },
      update: {},
      create: {
        userId: users[0].id,
        dappId: dapps[1].id,
      },
    }),
    prisma.userDappFavorite.upsert({
      where: {
        userId_dappId: {
          userId: users[1].id,
          dappId: dapps[2].id,
        },
      },
      update: {},
      create: {
        userId: users[1].id,
        dappId: dapps[2].id,
      },
    }),
    prisma.userDappFavorite.upsert({
      where: {
        userId_dappId: {
          userId: users[1].id,
          dappId: dapps[5].id,
        },
      },
      update: {},
      create: {
        userId: users[1].id,
        dappId: dapps[5].id,
      },
    }),
  ]);

  console.log(`✅ Created ${userDappFavorites.length} user dapp favorites`);

  await seedApiKeys();

  await seedAdminUsers();

  await seedPointPriceConfigs();

  console.log("");
  console.log("🎉 Seed data created successfully!");
  console.log("");
  console.log("📊 Final Cache Status:");
  cacheHelpers.getCacheInfo();
  console.log("");
  console.log(
    "💡 Tip: Next time you run this script, it will use cached vendor data for faster execution.",
  );
  console.log(
    "💡 To force fresh API calls, uncomment the clearCache() line in the main function.",
  );
}

async function seedPointPriceConfigs() {
  console.log("\n💎 Seeding point price configs...");

  const configs = [
    { currency: "IDR", baseRate: "15" },
    { currency: "USD", baseRate: "0.001" },
    { currency: "JPY", baseRate: "0.15" },
  ];

  for (const config of configs) {
    await prisma.pointPriceConfig.upsert({
      where: {
        currency_isActive: { currency: config.currency, isActive: true },
      },
      update: { baseRate: config.baseRate },
      create: {
        currency: config.currency,
        baseRate: config.baseRate,
        isActive: true,
      },
    });

    console.log(`  ✅ ${config.currency}: 1 point = ${config.baseRate} ${config.currency}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
