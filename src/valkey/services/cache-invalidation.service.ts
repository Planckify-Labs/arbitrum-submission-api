import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Cache invalidation rules for Prisma models
 * Maps model operations to cache invalidation patterns
 */
interface TInvalidationRule {
  models: string[]; // Prisma model names
  operations: ('create' | 'update' | 'delete' | 'upsert' | 'deleteMany' | 'updateMany')[];
  patterns: string[]; // Cache key patterns to invalidate
  relatedModels?: string[]; // Related models to invalidate
}

/**
 * Service to handle automatic cache invalidation based on database mutations
 */
@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);
  private readonly invalidationRules: TInvalidationRule[] = [];

  constructor(private readonly cacheManager: CacheManagerService) {
    this.initializeRules();
  }

  /**
   * Initialize cache invalidation rules for all models
   * Customize patterns based on your caching strategy
   */
  private initializeRules(): void {
    this.invalidationRules.push(
      // Product mutations invalidate product and category caches
      {
        models: ['Product'],
        operations: ['create', 'update', 'delete', 'upsert'],
        patterns: [
          'product:*',
          'products:*',
          'catalog:*',
          'category:*:products',
        ],
        relatedModels: ['ProductPrice', 'ProductVariant'],
      },

      // Product price updates invalidate product caches
      {
        models: ['ProductPrice'],
        operations: ['create', 'update', 'delete', 'upsert'],
        patterns: ['product:*:prices', 'product:*:details', 'products:*'],
      },

      // Product variant updates invalidate product caches
      {
        models: ['ProductVariant'],
        operations: ['create', 'update', 'delete', 'upsert'],
        patterns: ['product:*:variants', 'product:*:details', 'products:*'],
      },

      // Category updates invalidate catalog and category caches
      {
        models: ['ProductCategory'],
        operations: ['create', 'update', 'delete', 'upsert'],
        patterns: ['category:*', 'catalog:*', 'categories:*'],
      },

      // Exchange rate updates invalidate rate caches
      {
        models: ['ExchangeRate'],
        operations: ['create', 'update', 'delete'],
        patterns: ['exchange-rate:*', 'latest-rate:*'],
      },

      // Booking updates invalidate booking caches
      {
        models: ['BookingOrder'],
        operations: ['create', 'update', 'delete', 'upsert'],
        patterns: ['booking:*', 'user:*:bookings'],
      },

      // Purchase updates invalidate purchase and transaction caches
      {
        models: ['Purchase'],
        operations: ['create', 'update', 'delete'],
        patterns: ['purchase:*', 'user:*:purchases', 'transaction:*'],
        relatedModels: ['TransactionHistory'],
      },

      // Transaction updates invalidate transaction caches
      {
        models: ['TransactionHistory'],
        operations: ['create', 'update', 'delete'],
        patterns: ['transaction:*', 'user:*:transactions'],
      },

      // Blockchain config updates (rare, but critical)
      {
        models: ['Blockchain'],
        operations: ['create', 'update', 'delete'],
        patterns: ['blockchain:*', 'blockchains:*'],
      },

      // Token updates
      {
        models: ['Token'],
        operations: ['create', 'update', 'delete'],
        patterns: ['token:*', 'tokens:*'],
      },

      // Smart contract updates
      {
        models: ['SmartContract'],
        operations: ['create', 'update', 'delete'],
        patterns: ['contract:*', 'contracts:*'],
      },

      // Vendor API updates (already handled by vendor-api-cache.service, but added for completeness)
      {
        models: ['VendorAPI'],
        operations: ['create', 'update', 'delete'],
        patterns: ['vendorApi:*'],
      },

      // User updates invalidate user-specific caches
      {
        models: ['User'],
        operations: ['create', 'update', 'delete'],
        patterns: ['user:*:profile', 'user:*:bookings', 'user:*:purchases'],
      },
    );

    this.logger.log(`Initialized ${this.invalidationRules.length} cache invalidation rules`);
  }

  /**
   * Handle cache invalidation for a specific model and operation
   * Called by Prisma middleware
   */
  async handleInvalidation(
    model: string,
    operation: string,
    recordId?: string | number,
  ): Promise<void> {
    const matchingRules = this.invalidationRules.filter(
      (rule) =>
        rule.models.includes(model) &&
        (rule.operations as string[]).includes(operation),
    );

    if (matchingRules.length === 0) {
      this.logger.debug(`No invalidation rules for ${model}.${operation}`);
      return;
    }

    this.logger.debug(
      `Invalidating cache for ${model}.${operation} (ID: ${recordId ?? 'N/A'})`,
    );

    // Collect all patterns to invalidate
    const patternsToInvalidate = new Set<string>();

    for (const rule of matchingRules) {
      for (const pattern of rule.patterns) {
        // If recordId is provided, create specific key
        if (recordId && pattern.includes(':*')) {
          const specificPattern = pattern.replace(':*', `:${recordId}*`);
          patternsToInvalidate.add(specificPattern);
        }

        // Always invalidate the general pattern
        patternsToInvalidate.add(pattern);
      }
    }

    // Execute invalidation in parallel (fire and forget)
    const invalidationPromises = Array.from(patternsToInvalidate).map(
      (pattern) =>
        this.cacheManager
          .invalidatePattern(pattern)
          .catch((err) =>
            this.logger.error(
              `Failed to invalidate pattern ${pattern}: ${err.message}`,
            ),
          ),
    );

    await Promise.allSettled(invalidationPromises);
  }

  /**
   * Invalidate cache for specific model IDs
   * Useful for bulk operations where you know the affected IDs
   */
  async invalidateByModelIds(
    model: string,
    ids: (string | number)[],
  ): Promise<void> {
    const matchingRules = this.invalidationRules.filter((rule) =>
      rule.models.includes(model),
    );

    if (matchingRules.length === 0) return;

    const keysToInvalidate: string[] = [];

    for (const rule of matchingRules) {
      for (const pattern of rule.patterns) {
        for (const id of ids) {
          const key = pattern.replace('*', id.toString());
          keysToInvalidate.push(key);
        }
      }
    }

    await this.cacheManager.invalidateKeys(keysToInvalidate);
  }

  /**
   * Manual invalidation by pattern (for custom cache keys)
   */
  invalidateByPattern(pattern: string): Promise<number> {
    return this.cacheManager.invalidatePattern(pattern);
  }

  /**
   * Manual invalidation by exact key
   */
  invalidateByKey(key: string): Promise<void> {
    return this.cacheManager.invalidate(key);
  }

  /**
   * Add custom invalidation rule at runtime
   */
  addRule(rule: TInvalidationRule): void {
    this.invalidationRules.push(rule);
    this.logger.log(`Added custom invalidation rule for models: ${rule.models.join(', ')}`);
  }

  /**
   * Get all registered invalidation rules
   */
  getRules(): TInvalidationRule[] {
    return [...this.invalidationRules];
  }
}
