import { Injectable, Logger } from '@nestjs/common';
import { ValkeyService } from '../valkey.service';

/**
 * Rate limiting via atomic Redis INCR — no JSON serialization, no race conditions.
 *
 * Algorithm:
 *  1. INCR rate-limit:{key}            → atomic counter increment
 *  2. If count === 1 (new window): EXPIRE sets the window TTL
 *  3. TTL on the key tells us when the window resets
 *
 * Two commands per request (INCR + TTL), one extra EXPIRE on first request.
 * Previous implementation used GET + JSON parse + SET per request.
 */
@Injectable()
export class RateLimitCacheService {
  private readonly logger = new Logger(RateLimitCacheService.name);

  constructor(private readonly valkeyService: ValkeyService) {}

  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const countKey = `rate-limit:${key}`;
    const windowSeconds = Math.ceil(windowMs / 1000);

    try {
      // Atomic increment — safe under concurrent requests across pods
      const count = await this.valkeyService.incr(countKey);

      if (count === 1) {
        // First request in this window — set expiry (fire-and-forget, non-critical)
        this.valkeyService.expire(countKey, windowSeconds).catch((err) =>
          this.logger.warn(`Failed to set rate-limit TTL for ${key}: ${err.message}`),
        );
      }

      // Get remaining TTL to compute resetAt
      const ttlSeconds = await this.valkeyService.ttl(countKey);
      const resetAt =
        ttlSeconds > 0
          ? Date.now() + ttlSeconds * 1000
          : Date.now() + windowMs;

      return {
        allowed: count <= maxRequests,
        remaining: Math.max(0, maxRequests - count),
        resetAt,
      };
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${key}:`, error);
      // Fail open — allow the request on cache errors
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt: Date.now() + windowMs,
      };
    }
  }

  async resetRateLimit(key: string): Promise<void> {
    const countKey = `rate-limit:${key}`;
    await this.valkeyService.del(countKey);
    this.logger.debug(`Rate limit reset for key ${key}`);
  }
}
