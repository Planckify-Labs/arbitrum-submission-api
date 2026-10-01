import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { ValkeyService } from "../valkey.service";
import { BlockchainCacheService } from "./blockchain-cache.service";
import { CacheWarmingService } from "./cache-warming.service";
import { ExchangeRateCacheService } from "./exchange-rate-cache.service";
import { ProductCacheService } from "./product-cache.service";

describe("CacheWarmingService", () => {
  const prisma = {
    product: { findMany: jest.fn(async () => []) },
    exchangeRate: { findMany: jest.fn(async () => []) },
    category: { findMany: jest.fn(async () => []) },
    blockchain: { findMany: jest.fn(async () => []) },
  };

  const productCache = {
    warmUpCache: jest.fn(async () => undefined),
    getCatalogGrouped: jest.fn(async (fallback: () => unknown) => fallback()),
  };

  const exchangeRateCache = { warmUpCache: jest.fn(async () => undefined) };

  const blockchainCache = {
    getByChainId: jest.fn(),
    getByChainSlug: jest.fn(),
    setBlockchain: jest.fn(),
  };

  const config = {
    get: (_key: string, def?: string) => def,
  } as unknown as ConfigService;

  const valkey = {
    waitForConnection: jest.fn(async () => true),
  } as unknown as ValkeyService;

  let service: CacheWarmingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CacheWarmingService(
      config,
      valkey,
      prisma as unknown as PrismaService,
      productCache as unknown as ProductCacheService,
      exchangeRateCache as unknown as ExchangeRateCacheService,
      blockchainCache as unknown as BlockchainCacheService,
    );
  });

  // `catalog:grouped` is read by the mobile Redeem screen as
  // `{ category, products }[]`. ProductsService.findAllGroupedByCategories is
  // its only legitimate producer; a second writer here once cached a
  // different shape at startup and blanked the screen for an hour.
  it("never writes the grouped catalog cache key", async () => {
    const result = await service.triggerWarmup();

    expect(result.success).toBe(true);
    expect(productCache.getCatalogGrouped).not.toHaveBeenCalled();
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it("still warms the other caches", async () => {
    await service.triggerWarmup();

    expect(prisma.product.findMany).toHaveBeenCalled();
    expect(exchangeRateCache.warmUpCache).toHaveBeenCalled();
    expect(prisma.blockchain.findMany).toHaveBeenCalled();
  });
});
