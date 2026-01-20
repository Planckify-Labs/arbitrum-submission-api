import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { of, from } from 'rxjs';
import { tap, switchMap } from 'rxjs/operators';
import { CacheManagerService } from '../services/cache-manager.service';
import {
  CACHE_KEY_METADATA,
  CACHE_TTL_METADATA,
  buildCacheKey,
} from '../decorators/cache.decorator';

/**
 * Interceptor that implements method-level caching using @Cacheable decorator
 */
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheManager: CacheManagerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const keyPattern = this.reflector.get<string>(
      CACHE_KEY_METADATA,
      context.getHandler(),
    );

    const ttl = this.reflector.get<number>(
      CACHE_TTL_METADATA,
      context.getHandler(),
    );

    // If no cache metadata, skip caching
    if (!keyPattern) {
      return next.handle();
    }

    const methodArgs = context.getArgs();
    const cacheKey = buildCacheKey(keyPattern, methodArgs);

    this.logger.debug(`Cache check for key: ${cacheKey}`);

    // Try to get from cache
    return from(this.cacheManager.get(cacheKey)).pipe(
      switchMap((cachedValue) => {
        if (cachedValue !== null) {
          this.logger.debug(`Cache HIT: ${cacheKey}`);
          return of(cachedValue);
        }

        this.logger.debug(`Cache MISS: ${cacheKey}`);

        // Cache miss - execute method and cache result
        return next.handle().pipe(
          tap(async (result) => {
            if (result !== null && result !== undefined) {
              try {
                await this.cacheManager.set(cacheKey, result, ttl);
                this.logger.debug(`Cached result for key: ${cacheKey}`);
              } catch (error) {
                this.logger.error(
                  `Failed to cache result for ${cacheKey}: ${error.message}`,
                );
              }
            }
          }),
        );
      }),
    );
  }
}
