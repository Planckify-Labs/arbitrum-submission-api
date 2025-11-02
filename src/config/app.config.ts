import { ConfigService } from "@nestjs/config";

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
  corsCredentials: boolean;
  maxRequestSize: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  apiKeyWindowMs: number;
  apiKeyMaxRequests: number;
}

export interface BookingConfig {
  expiryMinutes: number;
  rateLimitWindowMinutes: number;
  rateLimitMaxRequests: number;
}

export interface BlockchainConfig {
  adminWalletPrivateKey: string;
  chainId: number;
  minConfirmations: number;
}

export function getAppConfig(configService: ConfigService): AppConfig {
  return {
    port: toNumber(configService.get("PORT"), 4000),
    nodeEnv: configService.get<string>("NODE_ENV", "development"),
    corsOrigins: configService
      .get<string>("CORS_ORIGINS", "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim()),
    corsCredentials:
      configService.get<string>("CORS_CREDENTIALS", "true") === "true",
    maxRequestSize: configService.get<string>("MAX_REQUEST_SIZE", "10mb"),
  };
}

export function getRateLimitConfig(
  configService: ConfigService,
): RateLimitConfig {
  return {
    windowMs: toNumber(
      configService.get("RATE_LIMIT_WINDOW_MS"),
      60000,
    ),
    maxRequests: toNumber(
      configService.get("RATE_LIMIT_MAX_REQUESTS"),
      100,
    ),
    apiKeyWindowMs: toNumber(
      configService.get("RATE_LIMIT_API_KEY_WINDOW_MS"),
      60000,
    ),
    apiKeyMaxRequests: toNumber(
      configService.get("RATE_LIMIT_API_KEY_MAX_REQUESTS"),
      1000,
    ),
  };
}

export function getBookingConfig(configService: ConfigService): BookingConfig {
  return {
    expiryMinutes: toNumber(
      configService.get("BOOKING_EXPIRY_MINUTES"),
      15,
    ),
    rateLimitWindowMinutes: toNumber(
      configService.get("BOOKING_RATE_LIMIT_WINDOW_MINUTES"),
      15,
    ),
    rateLimitMaxRequests: toNumber(
      configService.get("BOOKING_RATE_LIMIT_MAX_REQUESTS"),
      10,
    ),
  };
}

export function getBlockchainConfig(
  configService: ConfigService,
): BlockchainConfig {
  const privateKey = configService.get<string>("ADMIN_WALLET_PRIVATE_KEY");

  if (!privateKey) {
    throw new Error(
      "ADMIN_WALLET_PRIVATE_KEY is not defined in environment variables. " +
        "Please set ADMIN_WALLET_PRIVATE_KEY in your .env file.",
    );
  }

  if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
    throw new Error(
      "ADMIN_WALLET_PRIVATE_KEY must be a valid Ethereum private key starting with '0x' and 64 hex characters.",
    );
  }

  return {
    adminWalletPrivateKey: privateKey,
    chainId: toNumber(configService.get("CHAIN_ID"), 1),
    minConfirmations: toNumber(configService.get("MIN_CONFIRMATIONS"), 12),
  };
}
