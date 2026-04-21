import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Blockchain-specific caching service
 * Caches blockchain configuration data which is read frequently but rarely changes
 *
 * Cache Keys:
 * - blockchain:{id} - Blockchain by ID (most common lookup in hot paths)
 * - blockchain:chainId:{chainId} - Blockchain by chain ID
 * - blockchains:active - List of active blockchains
 * - blockchains:all - List of all blockchains
 */
@Injectable()
export class BlockchainCacheService {
  private readonly logger = new Logger(BlockchainCacheService.name);
  private readonly TTL = {
    BLOCKCHAIN: 3600, // 1 hour - blockchain config rarely changes
    BLOCKCHAIN_LIST: 3600, // 1 hour
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  /**
   * Get blockchain by ID with cache-aside pattern
   * This is the most frequently called method (purchase processor, transactions, etc.)
   */
  async getById<T>(
    blockchainId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('blockchain', blockchainId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.BLOCKCHAIN,
    });
  }

  /**
   * Get blockchain by chain ID with cache-aside pattern
   */
  async getByChainId<T>(
    chainId: number,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('blockchain', 'chainId', chainId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.BLOCKCHAIN,
    });
  }

  /**
   * Get active blockchains list with cache-aside pattern
   * Used by blockchain-verification service on initialization
   */
  async getActiveBlockchains<T>(fallback: () => Promise<T>): Promise<T> {
    const key = 'blockchains:active';
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.BLOCKCHAIN_LIST,
    });
  }

  /**
   * Get all blockchains list with cache-aside pattern
   */
  async getAllBlockchains<T>(
    cursor: string | number | undefined,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'blockchains',
      'all',
      'page',
      cursor ?? 'first',
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.BLOCKCHAIN_LIST,
    });
  }

  /**
   * Cache-aside for the enriched `/blockchains` config payload (§6.7, task 21).
   * Keyed on country segment so `country=ID` and "all" don't collide. 5-minute
   * TTL — the response is read-hot but chain-config drifts rarely; shorter TTLs
   * would burn Valkey writes with no upside.
   *
   * Invalidation piggybacks on {@link invalidateBlockchain}'s existing
   * `blockchains:*` pattern sweep — any admin update to a chain row clears this
   * key along with the paginated list caches.
   */
  async getEnrichedConfig<T>(
    countrySegment: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'blockchains',
      'config',
      'enriched',
      countrySegment,
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: 5 * 60, // 5 minutes
    });
  }

  /**
   * Set blockchain in cache (for write-through pattern)
   */
  async setBlockchain<T>(blockchainId: string, data: T): Promise<void> {
    const key = this.cacheManager.buildKey('blockchain', blockchainId);
    await this.cacheManager.set(key, data, this.TTL.BLOCKCHAIN);
  }

  /**
   * Invalidate all blockchain-related caches
   * Called when blockchain is created/updated/deleted
   */
  async invalidateBlockchain(blockchainId?: string): Promise<void> {
    const patterns = [
      'blockchains:*', // All blockchain lists
    ];

    if (blockchainId) {
      patterns.push(`blockchain:${blockchainId}`);
    } else {
      patterns.push('blockchain:*');
    }

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(
      `Invalidated blockchain cache (ID: ${blockchainId ?? 'all'})`,
    );
  }

  /**
   * Batch get multiple blockchains by ID
   */
  async batchGetBlockchains<T>(
    blockchainIds: string[],
    fallback: (missingIds: string[]) => Promise<Map<string, T>>,
  ): Promise<Map<string, T>> {
    const keys = blockchainIds.map((id) =>
      this.cacheManager.buildKey('blockchain', id),
    );

    const cached = await this.cacheManager.mget<T>(keys);

    const missingIds = blockchainIds.filter(
      (id) => !cached.has(this.cacheManager.buildKey('blockchain', id)),
    );

    if (missingIds.length === 0) {
      const result = new Map<string, T>();
      blockchainIds.forEach((id) => {
        const key = this.cacheManager.buildKey('blockchain', id);
        const value = cached.get(key);
        if (value) result.set(id, value);
      });
      return result;
    }

    const dbResults = await fallback(missingIds);

    const toCache = new Map<string, T>();
    for (const [id, blockchain] of dbResults) {
      const key = this.cacheManager.buildKey('blockchain', id);
      toCache.set(key, blockchain);
    }

    await this.cacheManager.mset(toCache, this.TTL.BLOCKCHAIN);

    const result = new Map<string, T>();
    blockchainIds.forEach((id) => {
      const cachedValue = cached.get(this.cacheManager.buildKey('blockchain', id));
      const dbValue = dbResults.get(id);
      if (cachedValue) result.set(id, cachedValue);
      else if (dbValue) result.set(id, dbValue);
    });

    return result;
  }
}
