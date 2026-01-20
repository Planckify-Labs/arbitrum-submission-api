import { Injectable, Logger } from '@nestjs/common';
import { ValkeyService } from '../valkey.service';
import type {
  TCacheConfig,
  TCachedData,
  TCacheKeyBuilder,
} from '../interfaces/cache-config.interface';

/**
 * Advanced cache manager with support for multiple caching patterns
 * Provides utilities for cache-aside, write-through, TTL-based, and invalidation strategies
 */
@Injectable()
export class CacheManagerService implements TCacheKeyBuilder {
  private readonly logger = new Logger(CacheManagerService.name);
  private readonly defaultTTL = 3600; // 1 hour default

  constructor(private readonly valkeyService: ValkeyService) {}

  /**
   * Build cache key from parts
   * Example: buildKey('product', 123, 'details') => 'product:123:details'
   */
  buildKey(...parts: (string | number)[]): string {
    return parts.join(':');
  }

  /**
   * Build cache pattern for deletion
   * Example: buildPattern('product:*') => 'product:*'
   */
  buildPattern(pattern: string): string {
    return pattern;
  }

  /**
   * Wrap data with metadata for cache tracking
   * Note: TTL is managed by Redis EXPIRE command, not client-side.
   * Metadata is for observability (when was this cached, version tracking).
   */
  private wrapWithMetadata<T>(data: T): TCachedData<T> {
    return {
      data,
      metadata: {
        cachedAt: Date.now(),
        version: '1.0',
      },
    };
  }

  /**
   * Unwrap cached data
   * Note: TTL expiration is handled by Redis server-side, not client-side.
   * If we receive data, it's valid (not expired).
   */
  private unwrapCachedData<T>(
    cached: string | null,
  ): TCachedData<T> | null {
    if (!cached) return null;

    try {
      const parsed: TCachedData<T> = JSON.parse(cached);
      return parsed;
    } catch (error) {
      this.logger.warn(`Failed to parse cached data: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache-Aside Pattern: Get with automatic fallback to database
   * @param key Cache key
   * @param fallback Function to fetch from database if cache miss
   * @param config Cache configuration (TTL, prefix)
   */
  async cacheAside<T>(
    key: string,
    fallback: () => Promise<T>,
    config?: TCacheConfig,
  ): Promise<T> {
    const cacheKey = config?.prefix ? this.buildKey(config.prefix, key) : key;

    try {
      // Try to get from cache
      const cached = await this.valkeyService.get(cacheKey);
      const unwrapped = this.unwrapCachedData<T>(cached);

      if (unwrapped) {
        this.logger.debug(`Cache HIT: ${cacheKey}`);
        return unwrapped.data;
      }

      this.logger.debug(`Cache MISS: ${cacheKey}`);
    } catch (error) {
      this.logger.warn(`Cache read error for ${cacheKey}: ${error.message}`);
    }

    // Cache miss - fetch from database
    const data = await fallback();

    // Store in cache (fire and forget)
    this.set(cacheKey, data, config?.ttl ?? this.defaultTTL).catch((err) =>
      this.logger.error(`Failed to cache ${cacheKey}: ${err.message}`),
    );

    return data;
  }

  /**
   * Set cache with metadata and TTL
   * TTL is managed server-side by Redis EXPIRE command for reliability.
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    try {
      const wrapped = this.wrapWithMetadata(data);
      const serialized = JSON.stringify(wrapped);

      if (ttl) {
        await this.valkeyService.set(key, serialized, { ttl });
      } else {
        await this.valkeyService.set(key, serialized);
      }

      this.logger.debug(`Cache SET: ${key} (TTL: ${ttl ?? 'none'}s)`);
    } catch (error) {
      this.logger.error(`Failed to set cache ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get cached data
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.valkeyService.get(key);
      const unwrapped = this.unwrapCachedData<T>(cached);
      return unwrapped?.data ?? null;
    } catch (error) {
      this.logger.warn(`Cache get error for ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get multiple keys at once (batch operation)
   */
  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    try {
      const values = await this.valkeyService.mget(keys);

      keys.forEach((key, index) => {
        const unwrapped = this.unwrapCachedData<T>(values[index]);
        if (unwrapped) {
          result.set(key, unwrapped.data);
        }
      });
    } catch (error) {
      this.logger.warn(`Cache mget error: ${error.message}`);
    }

    return result;
  }

  /**
   * Set multiple keys at once (batch operation)
   */
  async mset<T>(entries: Map<string, T>, ttl?: number): Promise<void> {
    try {
      const wrappedRecord: Record<string, string> = {};

      for (const [key, value] of entries) {
        const data = this.wrapWithMetadata(value);
        wrappedRecord[key] = JSON.stringify(data);
      }

      await this.valkeyService.mset(wrappedRecord);

      // Set TTL for each key if specified
      if (ttl) {
        const expirePromises = Array.from(entries.keys()).map((key) =>
          this.valkeyService.expire(key, ttl),
        );
        await Promise.all(expirePromises);
      }

      this.logger.debug(`Cache MSET: ${entries.size} keys (TTL: ${ttl ?? 'none'}s)`);
    } catch (error) {
      this.logger.error(`Failed to mset cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete single key
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.valkeyService.del(key);
      this.logger.debug(`Cache INVALIDATE: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to invalidate ${key}: ${error.message}`);
    }
  }

  /**
   * Delete multiple keys by pattern (e.g., 'product:*')
   * Uses SCAN for memory-efficient pattern matching
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.scanKeys(pattern);

      if (keys.length === 0) {
        this.logger.debug(`No keys found for pattern: ${pattern}`);
        return 0;
      }

      // Delete in batches
      await Promise.all(keys.map((key) => this.valkeyService.del(key)));

      this.logger.debug(`Cache INVALIDATE PATTERN: ${pattern} (${keys.length} keys)`);
      return keys.length;
    } catch (error) {
      this.logger.error(
        `Failed to invalidate pattern ${pattern}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Scan keys by pattern using SCAN command (cursor-based iteration)
   * More memory-efficient than KEYS command for large datasets
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    try {
      do {
        // Use SCAN with MATCH pattern
        const result = await this.valkeyService.customCommand([
          'SCAN',
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          '100',
        ]);

        if (Array.isArray(result) && result.length === 2) {
          cursor = result[0] as string;
          const foundKeys = result[1] as string[];
          keys.push(...foundKeys);
        } else {
          break;
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`SCAN failed for pattern ${pattern}: ${error.message}`);
    }

    return keys;
  }

  /**
   * Invalidate multiple specific keys
   */
  async invalidateKeys(keys: string[]): Promise<void> {
    try {
      await Promise.all(keys.map((key) => this.valkeyService.del(key)));
      this.logger.debug(`Cache INVALIDATE: ${keys.length} keys`);
    } catch (error) {
      this.logger.error(`Failed to invalidate keys: ${error.message}`);
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    try {
      return await this.valkeyService.exists(key);
    } catch (error) {
      this.logger.warn(`Cache exists check error for ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get remaining TTL for a key
   */
  async getTTL(key: string): Promise<number | null> {
    try {
      return await this.valkeyService.ttl(key);
    } catch (error) {
      this.logger.warn(`Cache TTL check error for ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Refresh TTL for existing key without changing value
   */
  async refreshTTL(key: string, ttl: number): Promise<void> {
    try {
      await this.valkeyService.expire(key, ttl);
      this.logger.debug(`Cache REFRESH TTL: ${key} (${ttl}s)`);
    } catch (error) {
      this.logger.error(`Failed to refresh TTL for ${key}: ${error.message}`);
    }
  }

  /**
   * Write-Through Pattern: Update cache and database together
   */
  async writeThrough<T>(
    key: string,
    data: T,
    dbWriter: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    // Write to database first
    const result = await dbWriter();

    // Then update cache (fire and forget to not block response)
    this.set(key, result, ttl).catch((err) =>
      this.logger.error(`Write-through cache update failed: ${err.message}`),
    );

    return result;
  }

  /**
   * Increment counter (useful for analytics, view counts)
   */
  async increment(key: string, amount = 1): Promise<number> {
    try {
      if (amount === 1) {
        return await this.valkeyService.incr(key);
      }
      // For amounts > 1, use custom INCRBY command
      const result = await this.valkeyService.customCommand(['INCRBY', key, amount.toString()]);
      return Number(result);
    } catch (error) {
      this.logger.error(`Failed to increment ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Decrement counter
   */
  async decrement(key: string, amount = 1): Promise<number> {
    try {
      if (amount === 1) {
        return await this.valkeyService.decr(key);
      }
      // For amounts > 1, use custom DECRBY command
      const result = await this.valkeyService.customCommand(['DECRBY', key, amount.toString()]);
      return Number(result);
    } catch (error) {
      this.logger.error(`Failed to decrement ${key}: ${error.message}`);
      throw error;
    }
  }
}
