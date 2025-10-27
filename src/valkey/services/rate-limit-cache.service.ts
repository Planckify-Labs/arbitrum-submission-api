import { Injectable, Logger } from "@nestjs/common";
import { ValkeyService } from "../valkey.service";

interface RateLimitInfo {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitCacheService {
  private readonly logger = new Logger(RateLimitCacheService.name);

  constructor(private readonly valkeyService: ValkeyService) {}

  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const rateLimitKey = `rate-limit:${key}`;
    const data = await this.valkeyService.get<RateLimitInfo>(rateLimitKey);

    const now = Date.now();
    let rateLimitInfo: RateLimitInfo;

    if (!data) {
      rateLimitInfo = {
        count: 1,
        resetAt: now + windowMs,
      };
      await this.valkeyService.set(
        rateLimitKey,
        JSON.stringify(rateLimitInfo),
        { ttl: Math.ceil(windowMs / 1000) },
      );

      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt: rateLimitInfo.resetAt,
      };
    }

    try {
      rateLimitInfo = data;

      if (rateLimitInfo.resetAt < now) {
        rateLimitInfo = {
          count: 1,
          resetAt: now + windowMs,
        };
        await this.valkeyService.set(
          rateLimitKey,
          JSON.stringify(rateLimitInfo),
          { ttl: Math.ceil(windowMs / 1000) },
        );

        return {
          allowed: true,
          remaining: maxRequests - 1,
          resetAt: rateLimitInfo.resetAt,
        };
      }

      if (rateLimitInfo.count >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: rateLimitInfo.resetAt,
        };
      }

      rateLimitInfo.count += 1;
      await this.valkeyService.set(
        rateLimitKey,
        JSON.stringify(rateLimitInfo),
        { ttl: Math.ceil((rateLimitInfo.resetAt - now) / 1000) },
      );

      return {
        allowed: true,
        remaining: maxRequests - rateLimitInfo.count,
        resetAt: rateLimitInfo.resetAt,
      };
    } catch (error) {
      this.logger.error(`Failed to parse rate limit data for ${key}:`, error);
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt: now + windowMs,
      };
    }
  }

  async resetRateLimit(key: string): Promise<void> {
    const rateLimitKey = `rate-limit:${key}`;
    await this.valkeyService.del(rateLimitKey);
    this.logger.debug(`Rate limit reset for key ${key}`);
  }
}
