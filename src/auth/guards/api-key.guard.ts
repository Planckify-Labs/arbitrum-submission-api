import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { IS_API_KEY_REQUIRED } from "../../decorators/api-key.decorator";
import { ApiKeysService } from "../../api-keys/api-keys.service";
import { RateLimitCacheService } from "../../valkey/services/rate-limit-cache.service";
import { getRateLimitConfig } from "../../config/app.config";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly apiKeyWindowMs: number;
  private readonly apiKeyMaxRequests: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeysService: ApiKeysService,
    private readonly rateLimitCacheService: RateLimitCacheService,
    private readonly configService: ConfigService,
  ) {
    const rateLimitConfig = getRateLimitConfig(this.configService);
    this.apiKeyWindowMs = rateLimitConfig.apiKeyWindowMs;
    this.apiKeyMaxRequests = rateLimitConfig.apiKeyMaxRequests;
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
    const apiKey = request.headers["x-api-key"];

    if (!apiKey) {
      this.logger.warn("API key missing in request headers");
      throw new UnauthorizedException("API key is required");
    }

    try {
      const validApiKey = await this.apiKeysService.validateApiKey(apiKey);

      if (!validApiKey) {
        this.logger.warn(
          `Invalid API key attempted: ${apiKey.substring(0, 8)}...`,
        );
        throw new UnauthorizedException("Invalid API key");
      }

      const rateLimitKey = `api-key:${validApiKey.id}`;
      const maxRequests = validApiKey.rateLimit || this.apiKeyMaxRequests;
      const windowMs = this.apiKeyWindowMs;

      const rateLimitResult = await this.rateLimitCacheService.checkRateLimit(
        rateLimitKey,
        maxRequests,
        windowMs,
      );

      if (!rateLimitResult.allowed) {
        const retryAfter = Math.ceil(
          (rateLimitResult.resetAt - Date.now()) / 1000,
        );
        this.logger.warn(
          `Rate limit exceeded for API key: ${validApiKey.name} (${validApiKey.id})`,
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: "Rate limit exceeded",
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      request.apiKey = validApiKey;
      this.logger.debug(
        `API key validation successful: ${validApiKey.name} (${validApiKey.type}), remaining: ${rateLimitResult.remaining}`,
      );
      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      this.logger.error("Error validating API key:", error);
      throw new UnauthorizedException("API key validation failed");
    }
  }
}
