import { Injectable, Logger } from "@nestjs/common";
import { CacheManagerService } from "./cache-manager.service";

/**
 * Cache service for the point system.
 *
 * Cache keys:
 * - point:price:{tokenId}:{currency}   - Computed point price (60 s)
 * - point:balance:{userId}             - User point balance    (30 s)
 * - point:config:{currency}            - Active PointPriceConfig (300 s)
 */
@Injectable()
export class PointsCacheService {
  private readonly logger = new Logger(PointsCacheService.name);

  private readonly TTL = {
    PRICE: 60,
    BALANCE: 30,
    CONFIG: 300,
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  async getPointPrice<T>(
    tokenId: string,
    currency: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey("point", "price", tokenId, currency);
    return this.cacheManager.cacheAside(key, fallback, { ttl: this.TTL.PRICE });
  }

  async getPointBalance<T>(
    userId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey("point", "balance", userId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.BALANCE,
    });
  }

  async getPointConfig<T>(
    currency: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey("point", "config", currency);
    return this.cacheManager.cacheAside(key, fallback, { ttl: this.TTL.CONFIG });
  }

  async invalidateBalance(userId: string): Promise<void> {
    const key = this.cacheManager.buildKey("point", "balance", userId);
    await this.cacheManager.invalidate(key);
    this.logger.debug(`Invalidated point balance cache for user ${userId}`);
  }

  async invalidateConfig(currency: string): Promise<void> {
    const key = this.cacheManager.buildKey("point", "config", currency);
    await this.cacheManager.invalidate(key);
    this.logger.debug(
      `Invalidated point config cache for currency ${currency}`,
    );
  }

  async invalidatePrices(): Promise<void> {
    await this.cacheManager.invalidatePattern("point:price:*");
    this.logger.debug("Invalidated all point price caches");
  }
}
