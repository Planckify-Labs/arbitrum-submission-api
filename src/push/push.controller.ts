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
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RegisterPushTokenDto } from "./dto/register-push-token.dto";
import { PushService } from "./push.service";

interface AuthedRequest {
  user?: { id: string };
}

@ApiTags("push")
@Controller("users/me")
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post("push-token")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Register the device Expo push token and its wallet subscriptions. Idempotent — safe to call on every cold start or after wallet list changes.",
  })
  async registerPushToken(
    @Request() req: AuthedRequest,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) return;
    await this.pushService.registerToken({
      userId,
      token: dto.token,
      platform: dto.platform,
      wallets: dto.wallets,
    });
  }
}
