import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Exchange rate caching service
 * Uses TTL-based cache-aside pattern for external exchange rate data
 *
 * Cache Keys:
 * - exchange-rate:latest:{fromCurrency}:{toCurrency} - Latest rate for currency pair
 * - exchange-rate:{id} - Specific rate by ID
 * - exchange-rate:average:{fromCurrency}:{toCurrency}:{days} - Average rate
 */
@Injectable()
export class ExchangeRateCacheService {
  private readonly logger = new Logger(ExchangeRateCacheService.name);
  private readonly TTL = {
    LATEST_RATE: 300, // 5 minutes - rates update frequently
    SPECIFIC_RATE: 3600, // 1 hour - historical rates don't change
    AVERAGE_RATE: 600, // 10 minutes - aggregated data
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  /**
   * Get latest exchange rate for currency pair
   */
  async getLatestRate<T>(
    fromCurrency: string,
    toCurrency: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'exchange-rate',
      'latest',
      fromCurrency.toUpperCase(),
      toCurrency.toUpperCase(),
    );

    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.LATEST_RATE,
    });
  }

  /**
   * Get specific exchange rate by ID
   */
  async getRate<T>(
    rateId: number | string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('exchange-rate', rateId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.SPECIFIC_RATE,
    });
  }

  /**
   * Get average exchange rate for currency pair over period
   */
  async getAverageRate<T>(
    fromCurrency: string,
    toCurrency: string,
    days: number,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'exchange-rate',
      'average',
      fromCurrency.toUpperCase(),
      toCurrency.toUpperCase(),
      days,
    );

    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.AVERAGE_RATE,
    });
  }

  /**
   * Batch get latest rates for multiple currency pairs
   * Efficient for fetching multiple rates at once
   */
  async batchGetLatestRates<T>(
    pairs: Array<{ from: string; to: string }>,
    fallback: (
      missingPairs: Array<{ from: string; to: string }>,
    ) => Promise<Map<string, T>>,
  ): Promise<Map<string, T>> {
    const keys = pairs.map((pair) =>
      this.cacheManager.buildKey(
        'exchange-rate',
        'latest',
        pair.from.toUpperCase(),
        pair.to.toUpperCase(),
      ),
    );

    // Get cached rates
    const cached = await this.cacheManager.mget<T>(keys);

    // Find missing pairs
    const missingPairs = pairs.filter(
      (pair) =>
        !cached.has(
          this.cacheManager.buildKey(
            'exchange-rate',
            'latest',
            pair.from.toUpperCase(),
            pair.to.toUpperCase(),
          ),
        ),
    );

    if (missingPairs.length === 0) {
      // All cached
      return cached;
    }

    // Fetch missing from database
    const dbResults = await fallback(missingPairs);

    // Cache missing rates
    const toCache = new Map<string, T>();
    for (const [pairKey, rate] of dbResults) {
      toCache.set(pairKey, rate);
    }

    await this.cacheManager.mset(toCache, this.TTL.LATEST_RATE);

    // Merge cached and fetched
    const result = new Map<string, T>(cached);
    for (const [pairKey, rate] of dbResults) {
      result.set(pairKey, rate);
    }

    return result;
  }

  /**
   * Invalidate exchange rate cache for currency pair
   */
  async invalidateRate(
    fromCurrency?: string,
    toCurrency?: string,
  ): Promise<void> {
    if (fromCurrency && toCurrency) {
      // Invalidate specific pair
      const pattern = this.cacheManager.buildPattern(
        `exchange-rate:*:${fromCurrency.toUpperCase()}:${toCurrency.toUpperCase()}*`,
      );
      await this.cacheManager.invalidatePattern(pattern);
      this.logger.debug(
        `Invalidated exchange rate cache for ${fromCurrency}/${toCurrency}`,
      );
    } else {
      // Invalidate all rates
      await this.cacheManager.invalidatePattern('exchange-rate:*');
      this.logger.debug('Invalidated all exchange rate caches');
    }
  }

  /**
   * Invalidate all latest rates (useful after batch update from external provider)
   */
  async invalidateAllLatestRates(): Promise<void> {
    await this.cacheManager.invalidatePattern('exchange-rate:latest:*');
    this.logger.log('Invalidated all latest exchange rate caches');
  }

  /**
   * Warm up cache with commonly used currency pairs
   */
  async warmUpCache<T>(
    popularPairs: Array<{ from: string; to: string }>,
    fetcher: (
      pairs: Array<{ from: string; to: string }>,
    ) => Promise<Map<string, T>>,
  ): Promise<void> {
    this.logger.log(`Warming up cache for ${popularPairs.length} currency pairs`);

    const rates = await fetcher(popularPairs);
    await this.cacheManager.mset(rates, this.TTL.LATEST_RATE);

    this.logger.log(`Cache warmed up for ${rates.size} currency pairs`);
  }

  /**
   * Get cached rate if available, return null if not cached (no DB fallback)
   * Useful for read-through scenarios where you want to check cache first
   */
  async getCachedRateOnly<T>(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<T | null> {
    const key = this.cacheManager.buildKey(
      'exchange-rate',
      'latest',
      fromCurrency.toUpperCase(),
      toCurrency.toUpperCase(),
    );

    return this.cacheManager.get<T>(key);
  }

  /**
   * Set rate in cache (useful for write-through pattern)
   */
  async setRate<T>(
    fromCurrency: string,
    toCurrency: string,
    rate: T,
    ttl?: number,
  ): Promise<void> {
    const key = this.cacheManager.buildKey(
      'exchange-rate',
      'latest',
      fromCurrency.toUpperCase(),
      toCurrency.toUpperCase(),
    );

    await this.cacheManager.set(key, rate, ttl ?? this.TTL.LATEST_RATE);
  }
}
