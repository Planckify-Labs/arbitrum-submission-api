import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { IS_API_KEY_REQUIRED } from "../../decorators/api-key.decorator";
import { ApiKeysService } from "../../api-keys/api-keys.service";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly apiKeysService: ApiKeysService,
  ) {}

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
      // First try database-based API keys
      const validApiKey = await this.apiKeysService.validateApiKey(apiKey);

      if (validApiKey) {
        // Attach API key info to request for logging and rate limiting
        request.apiKey = validApiKey;
        this.logger.debug(
          `API key validation successful: ${validApiKey.name} (${validApiKey.type})`,
        );
        return true;
      }

      // Fallback to environment-based API keys for backward compatibility
      const validApiKeys = this.getValidApiKeys();
      if (validApiKeys.includes(apiKey)) {
        this.logger.debug("API key validation successful (legacy)");
        return true;
      }

      this.logger.warn(
        `Invalid API key attempted: ${apiKey.substring(0, 8)}...`,
      );
      throw new UnauthorizedException("Invalid API key");
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error("Error validating API key:", error);
      throw new UnauthorizedException("API key validation failed");
    }
  }

  private getValidApiKeys(): string[] {
    const apiKeysEnv = this.configService.get<string>("API_KEYS");
    if (!apiKeysEnv) {
      return [];
    }

    // Support comma-separated API keys in environment variable
    return apiKeysEnv
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
  }
}
