import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SubmitUserOpDto } from "./dto/submit-userop.dto";
import type { SubmitUserOpResponseDto } from "./dto/submit-userop-response.dto";
import { UserOpService } from "./userop.service";

/**
 * Minimal authed-request shape — matches the same ad-hoc pattern the pay
 * controller uses so we don't drag the full passport typing through every
 * file.
 */
interface AuthedRequest {
  user?: {
    id: string;
    walletAddress?: string;
  };
}

/**
 * `POST /v1/userop/submit` — ERC-4337 bundler proxy (task 37, spec §6.7).
 *
 * Why this endpoint exists: the bundler (Pimlico / Alchemy / Stackup) is
 * API-keyed and rate-limited. Shipping the key into the mobile app — either
 * via `EXPO_PUBLIC_*` (leaked on device) or via a per-user OAuth exchange
 * (over-engineered for v1) — fails the "never on-device" rule in §10. The
 * server proxies so the key stays server-side and we get one audit row per
 * submission for free.
 *
 * Three-role separation: mobile signs the UserOp (task 35 adapter), this
 * proxy relays it verbatim, the bundler executes. The server NEVER
 * modifies the UserOp object — any mutation would invalidate the
 * signature.
 *
 * Auth: JWT-issued (SIWE or any other `/v1/*` auth — matches
 * `IntentsController`). Unauthenticated requests land on the global
 * `JwtAuthGuard` at the app level; we re-apply here for explicitness and
 * to keep the file readable in isolation.
 */
@Controller("userop")
@ApiTags("userop")
@UseGuards(JwtAuthGuard)
export class UserOpController {
  constructor(private readonly userOpService: UserOpService) {}

  @Post("submit")
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body() dto: SubmitUserOpDto,
    @Request() req: AuthedRequest,
  ): Promise<SubmitUserOpResponseDto> {
    // The JWT guard above guarantees `req.user` is present on a 2xx path.
    // Defense-in-depth: explicit check so that a misconfigured guard can't
    // silently nuke the rate-limit key (which would let an unauthenticated
    // caller burn the ambient 10/min budget).
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException({
        message: "Authenticated user is required.",
        code: "AUTH_REQUIRED",
      });
    }

    return await this.userOpService.submitUserOp({
      dto,
      userId,
    });
  }
}
