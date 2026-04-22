import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ValkeyService } from '../valkey.service';
import { BlockchainCacheService } from './blockchain-cache.service';
import { ProductCacheService } from './product-cache.service';
import { ExchangeRateCacheService } from './exchange-rate-cache.service';

/**
 * Cache warming service that pre-populates cache on application startup
 * Reduces cold-start latency for frequently accessed data
 */
@Injectable()
export class CacheWarmingService implements OnModuleInit {
  private readonly logger = new Logger(CacheWarmingService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly valkeyService: ValkeyService,
    private readonly prismaService: PrismaService,
    private readonly productCacheService: ProductCacheService,
    private readonly exchangeRateCacheService: ExchangeRateCacheService,
    private readonly blockchainCacheService: BlockchainCacheService,
  ) {
    this.enabled = this.configService.get<string>('CACHE_WARMING_ENABLED', 'true') === 'true';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Cache warming is disabled');
      return;
    }

    // Wait for Valkey connection before warming
    const isConnected = await this.valkeyService.waitForConnection(5000);
    if (!isConnected) {
      this.logger.warn('Valkey not connected, skipping cache warming');
      return;
    }

    // Run warming in background to not block app startup
    this.warmCaches().catch((err) => {
      this.logger.error(`Cache warming failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });
  }

  private async warmCaches(): Promise<void> {
    this.logger.log('Starting cache warming...');
    const startTime = Date.now();

    await Promise.allSettled([
      this.warmProductCache(),
      this.warmExchangeRateCache(),
      this.warmCatalogCache(),
      this.warmBlockchainCache(),
    ]);

    const duration = Date.now() - startTime;
    this.logger.log(`Cache warming completed in ${duration}ms`);
  }

  /**
   * Warm product cache with active products
   */
  private async warmProductCache(): Promise<void> {
    try {
      // Get IDs of active products (limited to avoid overloading)
      const activeProducts = await this.prismaService.product.findMany({
        where: { isActive: true },
        select: { id: true },
        take: 100, // Limit to top 100 products
        orderBy: { createdAt: 'desc' }, // Most recent first
      });

      if (activeProducts.length === 0) {
        this.logger.debug('No active products to warm');
        return;
      }

      const productIds = activeProducts.map((p) => p.id);

      await this.productCacheService.warmUpCache(productIds, async (ids) => {
        const products = await this.prismaService.product.findMany({
          where: { id: { in: ids } },
          include: {
            variants: {
              include: {
                ProductPrice: true,
              },
            },
            category: true,
          },
        });

        const result = new Map<string, typeof products[0]>();
        products.forEach((p) => result.set(p.id, p));
        return result;
      });

      this.logger.debug(`Warmed cache for ${productIds.length} products`);
    } catch (error) {
      this.logger.error(`Failed to warm product cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Warm exchange rate cache with common currency pairs
   */
  private async warmExchangeRateCache(): Promise<void> {
    try {
      // Common currency pairs to warm
      const popularPairs = [
        { from: 'USD', to: 'IDR' },
        { from: 'USDT', to: 'IDR' },
        { from: 'USDC', to: 'IDR' },
        { from: 'ETH', to: 'USD' },
        { from: 'ETH', to: 'IDR' },
      ];

      await this.exchangeRateCacheService.warmUpCache(popularPairs, async (pairs) => {
        const rates = await this.prismaService.exchangeRate.findMany({
          where: {
            OR: pairs.map((p) => ({
              fromCurrency: p.from,
              toCurrency: p.to,
            })),
          },
          orderBy: { createdAt: 'desc' },
          distinct: ['fromCurrency', 'toCurrency'],
        });

        const result = new Map<string, typeof rates[0]>();
        rates.forEach((r) => {
          const key = `exchange-rate:latest:${r.fromCurrency}:${r.toCurrency}`;
          result.set(key, r);
        });
        return result;
      });

      this.logger.debug(`Warmed cache for ${popularPairs.length} currency pairs`);
    } catch (error) {
      this.logger.error(`Failed to warm exchange rate cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Warm catalog cache (grouped products by category)
   */
  private async warmCatalogCache(): Promise<void> {
    try {
      // Fetch and cache grouped catalog
      await this.productCacheService.getCatalogGrouped(async () => {
        const categories = await this.prismaService.category.findMany({
          where: { isActive: true },
          include: {
            Product: {
              where: { isActive: true },
              include: {
                variants: {
                  include: {
                    ProductPrice: true,
                  },
                },
              },
              take: 10, // Limit products per category
            },
          },
          orderBy: { name: 'asc' },
        });

        return categories;
      });

      this.logger.debug('Warmed catalog cache');
    } catch (error) {
      this.logger.error(`Failed to warm catalog cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Warm blockchain cache with active chains so facilitator URLs and
   * gateway contracts are available from the first request.
   */
  private async warmBlockchainCache(): Promise<void> {
    try {
      const chains = await this.prismaService.blockchain.findMany({
        where: { isActive: true },
      });

      for (const chain of chains) {
        if (chain.chainId != null) {
          await this.blockchainCacheService.getByChainId(chain.chainId, async () => chain);
        }
        if (chain.chainSlug) {
          await this.blockchainCacheService.getByChainSlug(chain.chainSlug, async () => chain);
        }
        await this.blockchainCacheService.setBlockchain(chain.id, chain);
      }

      this.logger.debug(`Warmed cache for ${chains.length} blockchains`);
    } catch (error) {
      this.logger.error(`Failed to warm blockchain cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Manually trigger cache warming (can be called from admin endpoint)
   */
  async triggerWarmup(): Promise<{ success: boolean; duration: number }> {
    const startTime = Date.now();

    try {
      await this.warmCaches();
      return { success: true, duration: Date.now() - startTime };
    } catch (error) {
      this.logger.error(`Manual cache warming failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, duration: Date.now() - startTime };
    }
  }
}
