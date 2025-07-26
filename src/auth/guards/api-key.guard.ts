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

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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

    const validApiKeys = this.getValidApiKeys();

    if (!validApiKeys.includes(apiKey)) {
      this.logger.warn(`Invalid API key attempted: ${apiKey.substring(0, 8)}...`);
      throw new UnauthorizedException("Invalid API key");
    }

    this.logger.debug("API key validation successful");
    return true;
  }

  private getValidApiKeys(): string[] {
    const apiKeysEnv = this.configService.get<string>("API_KEYS");
    if (!apiKeysEnv) {
      this.logger.warn("No API keys configured in environment");
      return [];
    }

    // Support comma-separated API keys in environment variable
    return apiKeysEnv.split(",").map((key) => key.trim()).filter(Boolean);
  }
}
