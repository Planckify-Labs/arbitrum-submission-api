import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Request,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ApiKey } from "../decorators/api-key.decorator";
import { Public } from "../decorators/public.decorator";
import { ChannelResponseDto } from "./dto/channel-response.dto";
import { CreateMerchantDto } from "./dto/create-merchant.dto";
import { ListChannelsQueryDto } from "./dto/list-channels-query.dto";
import {
  MerchantResponseDto,
  MerchantWithQrResponseDto,
} from "./dto/merchant-response.dto";
import { PatchMerchantDto } from "./dto/patch-merchant.dto";
import { MerchantsService } from "./merchants.service";

/**
 * Minimal shape the JWT strategy puts on `req.user` — we only need `id`
 * for the /me endpoints. Mirrors the ad-hoc typing used across
 * `intents.controller.ts` and `address-book.controller.ts`.
 */
interface AuthedRequest {
  user?: { id: string };
}

/**
 * Merchant lifecycle endpoints (§6.1).
 *
 * Auth: JwtAuthGuard on every route — SIWE-issued JWT binds the
 * merchant to the authenticated user. No route accepts a client-supplied
 * user id.
 */
@Controller("merchants")
@ApiTags("merchants")
@UseGuards(JwtAuthGuard)
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  /**
   * Public channel lookup (spec §6.0, §6.1). Unauthenticated because
   * the mobile signup form needs this *before* the merchant has a
   * session — it drives the channel picker on `merchant/signup-form.tsx`.
   *
   * Filter-at-source: server orders by `priority ASC`, `channelCode
   * ASC`; mobile renders in received order. Unknown-but-well-formed
   * country codes (e.g. `PH` pre-launch) resolve to an empty array.
   * The `country` param defaults to `"ID"` when omitted; only a
   * present-but-malformed value (`country=zz9`, `country=USA`) is a
   * 400 via `ListChannelsQueryDto`.
   */
  @Get("channels")
  @Public()
  @ApiOperation({
    summary:
      "List active payout channels for a country — drives the merchant signup channel picker.",
  })
  @ApiQuery({ name: "country", required: false, example: "ID" })
  @ApiResponse({ status: 200, type: ChannelResponseDto, isArray: true })
  async listChannels(
    @Query() query: ListChannelsQueryDto,
  ): Promise<ChannelResponseDto[]> {
    // Country defaults to `"ID"` (v1 ships Indonesia only, spec §1).
    // Validation already ran inside `ListChannelsQueryDto`, so we know
    // the value (if present) is a 2-letter code.
    return this.merchantsService.listChannels(query.country ?? "ID");
  }

  @Post("signup")
  @Public()
  @ApiKey()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create merchant profile + sign JWS QR." })
  @ApiResponse({ status: 201, type: MerchantWithQrResponseDto })
  async signup(
    @Body() dto: CreateMerchantDto,
  ): Promise<MerchantWithQrResponseDto> {
    return this.merchantsService.signup(dto);
  }

  @Get("me")
  @ApiOperation({ summary: "Get authenticated user's merchant profile." })
  @ApiResponse({ status: 200, type: MerchantResponseDto })
  async me(@Request() req: AuthedRequest): Promise<MerchantResponseDto> {
    const userId = this.requireUserId(req);
    return this.merchantsService.findMeOrThrow(userId);
  }

  @Patch("me")
  @ApiOperation({
    summary:
      "Patch merchant profile — re-issues JWS if display name or payout coords change.",
  })
  @ApiResponse({ status: 200, type: MerchantResponseDto })
  async patchMe(
    @Body() dto: PatchMerchantDto,
    @Request() req: AuthedRequest,
  ): Promise<MerchantResponseDto> {
    const userId = this.requireUserId(req);
    return this.merchantsService.patchMe(userId, dto);
  }

  @Post("me/rotate-qr")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Manually re-issue the merchant QR JWS — used for operational rotation without touching profile fields.",
  })
  @ApiResponse({ status: 200, type: MerchantWithQrResponseDto })
  async rotateQr(
    @Request() req: AuthedRequest,
  ): Promise<MerchantWithQrResponseDto> {
    const userId = this.requireUserId(req);
    return this.merchantsService.rotateQr(userId);
  }

  /**
   * Guard rails — JwtAuthGuard should have populated `req.user.id`, but
   * we fail loudly (401) rather than crash with `undefined.id` if a
   * misconfigured guard lets a request through without a user.
   */
  private requireUserId(req: AuthedRequest): string {
    const id = req.user?.id;
    if (!id) {
      throw new UnauthorizedException({
        message: "Authenticated user id missing from request.",
        code: "AUTH_USER_MISSING",
      });
    }
    return id;
  }
}
