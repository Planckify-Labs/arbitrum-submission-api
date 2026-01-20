import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import type { CacheInvalidationService } from "../valkey/services/cache-invalidation.service";

type MutationOperation = 'create' | 'update' | 'delete' | 'upsert' | 'deleteMany' | 'updateMany' | 'createMany';

/**
 * Check if the operation is a mutation that should trigger cache invalidation
 */
function isMutationOperation(operation: string): operation is MutationOperation {
  return ['create', 'update', 'delete', 'upsert', 'deleteMany', 'updateMany', 'createMany'].includes(operation);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private cacheInvalidationService: CacheInvalidationService | null = null;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }

    const adapter = new PrismaPg({ connectionString });

    super({
      adapter,
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma client connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Set cache invalidation service (injected from ValkeyModule to avoid circular dependency)
   * Note: In Prisma 7.x, middleware ($use) is deprecated. Cache invalidation is now
   * triggered manually via this service or through the @InvalidateCache decorator.
   */
  setCacheInvalidationService(service: CacheInvalidationService): void {
    this.cacheInvalidationService = service;
    this.logger.log('Cache invalidation service registered');
  }

  /**
   * Get the cache invalidation service for manual invalidation calls
   */
  getCacheInvalidationService(): CacheInvalidationService | null {
    return this.cacheInvalidationService;
  }

  /**
   * Helper to invalidate cache after a mutation
   * Call this from your service layer after database mutations
   *
   * @example
   * ```typescript
   * const product = await this.prisma.product.update({ ... });
   * await this.prisma.invalidateCache('Product', 'update', product.id);
   * ```
   */
  async invalidateCache(
    model: string,
    operation: MutationOperation,
    recordId?: string | number,
  ): Promise<void> {
    if (!this.cacheInvalidationService) {
      this.logger.debug('Cache invalidation service not registered, skipping');
      return;
    }

    if (!isMutationOperation(operation)) {
      return;
    }

    try {
      await this.cacheInvalidationService.handleInvalidation(model, operation, recordId);
    } catch (err) {
      this.logger.error(
        `Cache invalidation failed for ${model}.${operation}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }
}
