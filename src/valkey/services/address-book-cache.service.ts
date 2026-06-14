import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Address book cache service
 * Caches user address book entries (user-scoped, relatively stable data)
 *
 * Cache Keys:
 * - address-book:{id} - Single address book entry
 * - user:{userId}:address-book:all - User's full address book list
 */
@Injectable()
export class AddressBookCacheService {
  private readonly logger = new Logger(AddressBookCacheService.name);
  private readonly TTL = {
    ENTRY: 600, // 10 minutes - individual entries
    USER_LIST: 300, // 5 minutes - user's address book list
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  /**
   * Get address book entry by ID
   */
  getById<T>(
    entryId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('address-book', entryId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.ENTRY,
    });
  }

  /**
   * Get all address book entries for a user
   */
  getUserAddressBook<T>(
    userId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'user',
      userId,
      'address-book',
      'all',
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.USER_LIST,
    });
  }

  /**
   * Invalidate address book cache
   * Call this when entries are created/updated/deleted
   */
  async invalidateEntry(
    entryId?: string,
    userId?: string,
  ): Promise<void> {
    const patterns: string[] = [];

    if (entryId) {
      patterns.push(`address-book:${entryId}`);
    }

    if (userId) {
      patterns.push(`user:${userId}:address-book:*`);
    }

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(
      `Invalidated address book cache (ID: ${entryId ?? 'N/A'}, User: ${userId ?? 'N/A'})`,
    );
  }

  /**
   * Invalidate user's address book list cache
   */
  async invalidateUserAddressBook(userId: string): Promise<void> {
    const pattern = this.cacheManager.buildPattern(
      `user:${userId}:address-book:*`,
    );
    await this.cacheManager.invalidatePattern(pattern);
    this.logger.debug(`Invalidated address book for user ${userId}`);
  }
}
