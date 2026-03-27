import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_API_KEY_REQUIRED } from '../../decorators/api-key.decorator';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import {
  NatsService,
  NatsCacheInvalidationPayload,
  NATS_SUBJECTS,
} from '../../nats/nats.service';
import type { ApiKey } from '@generated/prisma';

interface L1CacheEntry {
  apiKey: ApiKey;
  expiresAt: number;
}

/** TTL for the in-process L1 API key cache (milliseconds) */
const L1_TTL_MS = 60_000; // 60 seconds

/**
 * Validates API keys with a two-layer cache strategy:
 *
 *  L1 — in-process Map (this pod only, 60s TTL)
 *       → eliminates DB round-trips for repeated calls
 *  DB  — source of truth on L1 miss
 *
 * On key revocation/update, a NATS `cache.invalidate` event is published
 * by ApiKeysService so all pods evict the L1 entry immediately.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly l1Cache = new Map<string, L1CacheEntry>();

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeysService: ApiKeysService,
    @Optional() private readonly natsService?: NatsService,
  ) {}

  onModuleInit(): void {
    if (!this.natsService?.isConnected) return;

    this.natsService.subscribe<NatsCacheInvalidationPayload>(
      NATS_SUBJECTS.CACHE_INVALIDATE,
      (payload) => {
        // Only process messages from OTHER pods
        if (payload.instanceId === this.natsService!.instanceId) return;

        const apiKeyPrefix = 'apikey:';
        const keysToEvict = payload.l1Keys?.filter((k) =>
          k.startsWith(apiKeyPrefix),
        );

        if (keysToEvict?.length) {
          for (const key of keysToEvict) {
            const rawKey = key.slice(apiKeyPrefix.length);
            this.l1Cache.delete(rawKey);
          }
          this.logger.debug(
            `L1 evicted ${keysToEvict.length} API key(s) via NATS`,
          );
        }
      },
    );

    this.logger.log('Subscribed to NATS cache invalidation for L1 API key cache');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isApiKeyRequired = this.reflector.getAllAndOverride<boolean>(
      IS_API_KEY_REQUIRED,
      [context.getHandler(), context.getClass()],
    );

    if (!isApiKeyRequired) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      this.logger.warn('API key missing in request headers');
      throw new UnauthorizedException('API key is required');
    }

    try {
      const validApiKey = await this.resolveApiKey(apiKey);

      if (!validApiKey) {
        this.logger.warn(
          `Invalid API key attempted: ${apiKey.substring(0, 8)}...`,
        );
        throw new UnauthorizedException('Invalid API key');
      }

      request.apiKey = validApiKey;
      this.logger.debug(
        `API key validation successful: ${validApiKey.name} (${validApiKey.type})`,
      );
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('Error validating API key:', error);
      throw new UnauthorizedException('API key validation failed');
    }
  }

  private async resolveApiKey(keyValue: string): Promise<ApiKey | null> {
    // L1 cache check — skips DB + Valkey entirely
    const cached = this.l1Cache.get(keyValue);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.apiKey;
      }
      this.l1Cache.delete(keyValue);
    }

    // L1 miss — validate via DB (ApiKeysService also updates lastUsedAt)
    const apiKey = await this.apiKeysService.validateApiKey(keyValue);

    if (apiKey) {
      this.l1Cache.set(keyValue, { apiKey, expiresAt: Date.now() + L1_TTL_MS });
    }

    return apiKey;
  }

  /**
   * Evict a key from the L1 cache immediately (called on revoke/update).
   * Also publishes to NATS so all other pods evict theirs.
   */
  evictL1(keyValue: string): void {
    this.l1Cache.delete(keyValue);
    this.natsService?.publishCacheInvalidation({
      l1Keys: [`apikey:${keyValue}`],
    });
  }
}
