import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheManagerService } from '../services/cache-manager.service';
import {
  INVALIDATE_CACHE_METADATA,
  buildCacheKey,
} from '../decorators/cache.decorator';

/**
 * Interceptor that invalidates cache after method execution
 * Works with @InvalidateCache decorator
 */
@Injectable()
export class InvalidateCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(InvalidateCacheInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheManager: CacheManagerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const patterns = this.reflector.get<string | string[]>(
      INVALIDATE_CACHE_METADATA,
      context.getHandler(),
    );

    // If no invalidation metadata, skip
    if (!patterns) {
      return next.handle();
    }

    const patternsArray = Array.isArray(patterns) ? patterns : [patterns];
    const methodArgs = context.getArgs();

    return next.handle().pipe(
      tap(async (result) => {
        // Build cache keys from patterns and arguments
        const invalidationPromises = patternsArray.map(async (pattern) => {
          try {
            // Check if pattern contains placeholders
            if (pattern.includes('{')) {
              const cacheKey = buildCacheKey(pattern, methodArgs);
              // If the built key still contains wildcards, use pattern invalidation
              if (cacheKey.includes('*')) {
                const count = await this.cacheManager.invalidatePattern(cacheKey);
                this.logger.debug(`Invalidated ${count} keys for pattern: ${cacheKey}`);
              } else {
                await this.cacheManager.invalidate(cacheKey);
                this.logger.debug(`Invalidated cache key: ${cacheKey}`);
              }
            } else if (pattern.includes('*')) {
              // Pattern-based invalidation
              const count = await this.cacheManager.invalidatePattern(pattern);
              this.logger.debug(`Invalidated ${count} keys for pattern: ${pattern}`);
            } else {
              // Exact key invalidation
              await this.cacheManager.invalidate(pattern);
              this.logger.debug(`Invalidated cache key: ${pattern}`);
            }
          } catch (error) {
            this.logger.error(
              `Failed to invalidate cache for pattern ${pattern}: ${error.message}`,
            );
          }
        });

        // Fire and forget - don't block the response
        Promise.allSettled(invalidationPromises);
      }),
    );
  }
}
