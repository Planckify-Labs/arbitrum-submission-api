import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Smart contract-specific caching service
 * Caches smart contract data which is read frequently in purchase verification
 *
 * Cache Keys:
 * - contract:{id} - Smart contract by ID
 * - contract:{blockchainId}:{address} - Smart contract by blockchain + address (hot path lookup)
 * - contract:chainId:{chainId} - Smart contract by chain ID
 * - contracts:blockchain:{blockchainId} - All contracts for a blockchain
 * - contracts:all - List of all smart contracts
 */
@Injectable()
export class SmartContractCacheService {
  private readonly logger = new Logger(SmartContractCacheService.name);
  private readonly TTL = {
    CONTRACT: 3600, // 1 hour - contract config rarely changes
    CONTRACT_LIST: 3600, // 1 hour
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  /**
   * Get smart contract by ID with cache-aside pattern
   */
  getById<T>(contractId: string, fallback: () => Promise<T>): Promise<T> {
    const key = this.cacheManager.buildKey('contract', contractId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.CONTRACT,
    });
  }

  /**
   * Get smart contract by blockchain ID and address with cache-aside pattern
   * This is the hot path lookup used in purchase processor
   */
  getByBlockchainAndAddress<T>(
    blockchainId: string,
    address: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    // Normalize address to lowercase for consistent cache keys
    const normalizedAddress = address.toLowerCase();
    const key = this.cacheManager.buildKey(
      'contract',
      blockchainId,
      normalizedAddress,
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.CONTRACT,
    });
  }

  /**
   * Get smart contract by chain ID with cache-aside pattern
   */
  getByChainId<T>(
    chainId: number,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('contract', 'chainId', chainId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.CONTRACT,
    });
  }

  /**
   * Get all smart contracts for a blockchain with cache-aside pattern
   */
  getByBlockchain<T>(
    blockchainId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('contracts', 'blockchain', blockchainId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.CONTRACT_LIST,
    });
  }

  /**
   * Get all smart contracts list with cache-aside pattern
   */
  getAllContracts<T>(
    cursor: string | number | undefined,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'contracts',
      'all',
      'page',
      cursor ?? 'first',
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.CONTRACT_LIST,
    });
  }

  /**
   * Set smart contract in cache (for write-through pattern)
   */
  async setContract<T>(contractId: string, data: T): Promise<void> {
    const key = this.cacheManager.buildKey('contract', contractId);
    await this.cacheManager.set(key, data, this.TTL.CONTRACT);
  }

  /**
   * Set smart contract by blockchain and address (for write-through pattern)
   */
  async setContractByAddress<T>(
    blockchainId: string,
    address: string,
    data: T,
  ): Promise<void> {
    const normalizedAddress = address.toLowerCase();
    const key = this.cacheManager.buildKey(
      'contract',
      blockchainId,
      normalizedAddress,
    );
    await this.cacheManager.set(key, data, this.TTL.CONTRACT);
  }

  /**
   * Invalidate all smart contract-related caches
   * Called when smart contract is created/updated/deleted
   */
  async invalidateContract(contractId?: string): Promise<void> {
    const patterns = [
      'contracts:*', // All contract lists
    ];

    if (contractId) {
      patterns.push(`contract:${contractId}`);
    } else {
      patterns.push('contract:*');
    }

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(
      `Invalidated smart contract cache (ID: ${contractId ?? 'all'})`,
    );
  }

  /**
   * Invalidate smart contract by blockchain and address
   */
  async invalidateContractByAddress(
    blockchainId: string,
    address: string,
  ): Promise<void> {
    const normalizedAddress = address.toLowerCase();
    const key = this.cacheManager.buildKey(
      'contract',
      blockchainId,
      normalizedAddress,
    );
    await this.cacheManager.invalidate(key);
    this.logger.debug(
      `Invalidated contract cache for ${blockchainId}:${normalizedAddress}`,
    );
  }
}
