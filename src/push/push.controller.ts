import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { OptionalJwtAuthGuard } from "../auth/guards/optional-jwt-auth.guard";
import { ApiKey } from "../decorators/api-key.decorator";
import { Public } from "../decorators/public.decorator";
import { RegisterPushTokenDto } from "./dto/register-push-token.dto";
import { PushService } from "./push.service";

interface AuthedRequest {
  user?: { id: string };
}

@ApiTags("push")
@Controller("users/me")
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post("push-token")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  @ApiKey()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      "Register the device Expo push token and its wallet subscriptions. Public (X-API-Key gated) so devices can register before sign-in; if a valid JWT is also presented the token is linked to that user. Idempotent — safe to call on every cold start or after wallet list changes.",
  })
  async registerPushToken(
    @Request() req: AuthedRequest,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.pushService.registerToken({
      userId: req.user?.id ?? null,
      token: dto.token,
      platform: dto.platform,
      wallets: dto.wallets,
    });
  }
}
