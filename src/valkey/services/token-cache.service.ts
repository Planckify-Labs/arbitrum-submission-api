import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Token-specific caching service
 * Caches token data which is read frequently for transactions and lookups
 *
 * Cache Keys:
 * - token:{id} - Token by ID
 * - token:{blockchainId}:{contractAddress} - Token by blockchain + contract address
 * - token:{blockchainId}:symbol:{symbol} - Token by blockchain + symbol
 * - tokens:blockchain:{blockchainId} - All tokens for a blockchain
 * - tokens:blockchain:{blockchainId}:active - Active tokens for a blockchain
 * - tokens:all - List of all tokens
 */
@Injectable()
export class TokenCacheService {
  private readonly logger = new Logger(TokenCacheService.name);
  private readonly TTL = {
    TOKEN: 3600, // 1 hour - token config rarely changes
    TOKEN_LIST: 1800, // 30 minutes - lists may be paginated
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  /**
   * Get token by ID with cache-aside pattern
   */
  async getById<T>(tokenId: string, fallback: () => Promise<T>): Promise<T> {
    const key = this.cacheManager.buildKey('token', tokenId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.TOKEN,
    });
  }

  /**
   * Get token by blockchain ID and contract address with cache-aside pattern
   */
  async getByBlockchainAndAddress<T>(
    blockchainId: string,
    contractAddress: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const normalizedAddress = contractAddress.toLowerCase();
    const key = this.cacheManager.buildKey('token', blockchainId, normalizedAddress);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.TOKEN,
    });
  }

  /**
   * Get token by blockchain ID and symbol with cache-aside pattern
   */
  async getByBlockchainAndSymbol<T>(
    blockchainId: string,
    symbol: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'token',
      blockchainId,
      'symbol',
      symbol.toUpperCase(),
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.TOKEN,
    });
  }

  /**
   * Get all tokens for a blockchain with cache-aside pattern
   */
  async getByBlockchain<T>(
    blockchainId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('tokens', 'blockchain', blockchainId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.TOKEN_LIST,
    });
  }

  /**
   * Get active tokens for a blockchain with cache-aside pattern
   */
  async getActiveByBlockchain<T>(
    blockchainId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'tokens',
      'blockchain',
      blockchainId,
      'active',
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.TOKEN_LIST,
    });
  }

  /**
   * Get all tokens list with cache-aside pattern
   */
  async getAllTokens<T>(
    cursor: string | number | undefined,
    fallback: () => Promise<T>,
    take?: number,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'tokens',
      'all',
      `take-${take ?? 10}`,
      'page',
      cursor ?? 'first',
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.TOKEN_LIST,
    });
  }

  /**
   * Set token in cache (for write-through pattern)
   */
  async setToken<T>(tokenId: string, data: T): Promise<void> {
    const key = this.cacheManager.buildKey('token', tokenId);
    await this.cacheManager.set(key, data, this.TTL.TOKEN);
  }

  /**
   * Invalidate all token-related caches
   * Called when token is created/updated/deleted
   */
  async invalidateToken(tokenId?: string): Promise<void> {
    const patterns = [
      'tokens:*', // All token lists
    ];

    if (tokenId) {
      patterns.push(`token:${tokenId}`);
    } else {
      patterns.push('token:*');
    }

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(`Invalidated token cache (ID: ${tokenId ?? 'all'})`);
  }

  /**
   * Invalidate tokens for a specific blockchain
   */
  async invalidateByBlockchain(blockchainId: string): Promise<void> {
    const patterns = [
      `tokens:blockchain:${blockchainId}*`,
      `token:${blockchainId}:*`,
    ];

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(`Invalidated tokens for blockchain ${blockchainId}`);
  }

  /**
   * Batch get multiple tokens by ID
   */
  async batchGetTokens<T>(
    tokenIds: string[],
    fallback: (missingIds: string[]) => Promise<Map<string, T>>,
  ): Promise<Map<string, T>> {
    const keys = tokenIds.map((id) => this.cacheManager.buildKey('token', id));

    const cached = await this.cacheManager.mget<T>(keys);

    const missingIds = tokenIds.filter(
      (id) => !cached.has(this.cacheManager.buildKey('token', id)),
    );

    if (missingIds.length === 0) {
      const result = new Map<string, T>();
      tokenIds.forEach((id) => {
        const key = this.cacheManager.buildKey('token', id);
        const value = cached.get(key);
        if (value) result.set(id, value);
      });
      return result;
    }

    const dbResults = await fallback(missingIds);

    const toCache = new Map<string, T>();
    for (const [id, token] of dbResults) {
      const key = this.cacheManager.buildKey('token', id);
      toCache.set(key, token);
    }

    await this.cacheManager.mset(toCache, this.TTL.TOKEN);

    const result = new Map<string, T>();
    tokenIds.forEach((id) => {
      const cachedValue = cached.get(this.cacheManager.buildKey('token', id));
      const dbValue = dbResults.get(id);
      if (cachedValue) result.set(id, cachedValue);
      else if (dbValue) result.set(id, dbValue);
    });

    return result;
  }
}
