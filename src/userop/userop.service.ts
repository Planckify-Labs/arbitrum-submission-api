import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RateLimitCacheService } from "../valkey/services/rate-limit-cache.service";
import {
  BUNDLER_CLIENT,
  type IBundlerClient,
} from "./bundler.client";
import type { SubmitUserOpDto } from "./dto/submit-userop.dto";
import type { SubmitUserOpResponseDto } from "./dto/submit-userop-response.dto";

/**
 * Rate-limit budget per authenticated user. Per user-prompt scope §4:
 * "10 UserOps/minute. Use Valkey."
 *
 * Tuning rationale: a real scan-to-pay + gasless deposit flow submits at
 * most one UserOp per payment (the one-time Gateway deposit — subsequent
 * payments are Nanopay EIP-3009 signatures, not UserOps). 10/min leaves a
 * 10x headroom for retries while making a spam loop on a leaked JWT
 * obvious within a minute.
 */
export const USEROP_RATE_LIMIT_MAX_PER_MINUTE = 10;
export const USEROP_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * UserOp-submit proxy service (task 37, spec §6.7).
 *
 * Responsibilities:
 *   1. Chain whitelist via DB (`Blockchain.bundlerUrl`). Unknown chains
 *      → 400 `CHAIN_NOT_SUPPORTED`. A NULL column is the allowlist — no
 *      if/else on chainId inside the service (memory
 *      `feedback_chain_extension_discipline.md`). Ops seeds a row per
 *      chain via SQL / admin tooling, not a deploy.
 *   2. Rate-limit per authenticated user at 10 req/min via Valkey (§4).
 *   3. Forward the UserOp verbatim to the bundler. No re-shaping, no
 *      mutation — signature was computed over exact byte layout (memory
 *      `feedback_role_separation.md`).
 *   4. Mapped error surface:
 *        - bundler rejection (JSON-RPC error)   → 4xx, message echoed.
 *        - bundler upstream (5xx / malformed)   → 502.
 *        - bundler timeout                      → 504.
 *   5. Logging discipline (§5 user-prompt): log `sender` (user id),
 *      `entryPoint`, `chainId`. NEVER log `signature` or `callData` —
 *      may contain sensitive user inputs like token amounts / targets
 *      that, aggregated, reveal payment-flow patterns.
 */
@Injectable()
export class UserOpService {
  private readonly logger = new Logger(UserOpService.name);

  /**
   * Per-chain bundler URL cache. Bundler URLs rotate rarely (secret-manager
   * pattern will change the URL only when an API key is re-provisioned),
   * so a 60s TTL keeps the hot path off Postgres without making rotations
   * feel stale. The cache stores the resolved value including `null` so
   * we don't re-query every submit for unconfigured chains.
   */
  private static readonly BUNDLER_URL_CACHE_TTL_MS = 60_000;
  private readonly bundlerUrlCache = new Map<
    number,
    { url: string | null; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitCacheService,
    @Inject(BUNDLER_CLIENT)
    private readonly bundler: IBundlerClient,
  ) {}

  async submitUserOp(args: {
    dto: SubmitUserOpDto;
    userId: string;
  }): Promise<SubmitUserOpResponseDto> {
    const { dto, userId } = args;

    // Rate-limit BEFORE any env lookups. We want a leaked JWT to hit the
    // 429 ceiling regardless of whether the chain is supported; letting an
    // attacker enumerate `Blockchain.bundlerUrl` presence via differential 400/429
    // timings is a minor leak but not one we want to ship.
    const rl = await this.rateLimit.checkRateLimit(
      `userop:submit:${userId}`,
      USEROP_RATE_LIMIT_MAX_PER_MINUTE,
      USEROP_RATE_LIMIT_WINDOW_MS,
    );
    if (!rl.allowed) {
      throw new HttpException(
        {
          message: `UserOp submit rate limit exceeded (${USEROP_RATE_LIMIT_MAX_PER_MINUTE}/min). Try again in ${Math.max(
            0,
            Math.ceil((rl.resetAt - Date.now()) / 1000),
          )}s.`,
          code: "USEROP_RATE_LIMIT_EXCEEDED",
          resetAt: rl.resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Chain whitelist. DB-backed: `Blockchain.bundlerUrl` for the matching
    // chainId. No hardcoded chain branch. Extending to a new chain = one
    // SQL UPDATE, no code change. (memory
    // `feedback_chain_extension_discipline.md`.)
    const bundlerUrl = await this.resolveBundlerUrl(dto.chainId);
    if (!bundlerUrl) {
      throw new BadRequestException({
        message: `chainId ${dto.chainId} is not a supported bundler chain. Seed \`Blockchain.bundlerUrl\` for this chainId to enable it.`,
        code: "CHAIN_NOT_SUPPORTED",
        chainId: dto.chainId,
      });
    }

    // Safe observability. Per user-prompt scope §5 we log sender + entry
    // point + chainId, never signature or callData. `sender` in ERC-4337
    // parlance is the account address — we pull it off the packed userOp
    // ONLY if it's a plausible address string; otherwise "unknown".
    const sender = readStringField(dto.userOp, "sender");
    this.logger.log(
      `userOp submit user=${userId} chainId=${dto.chainId} entryPoint=${dto.entryPoint} sender=${sender ?? "unknown"}${dto.intentId ? ` intent=${dto.intentId}` : ""}`,
    );

    // Forward. We pass the dto.userOp OBJECT unchanged — no copy, no
    // field reshape. The bundler is the authority on UserOp validity.
    const outcome = await this.bundler.sendUserOperation({
      bundlerUrl,
      userOp: dto.userOp,
      entryPoint: dto.entryPoint,
      chainId: dto.chainId,
    });

    if (outcome.kind === "ok") {
      this.logger.log(
        `userOp submit user=${userId} chainId=${dto.chainId} hash=${outcome.userOpHash}`,
      );
      return {
        userOpHash: outcome.userOpHash,
        chainId: dto.chainId,
      };
    }

    if (outcome.kind === "rejected") {
      // Echo the bundler's JSON-RPC error verbatim as 4xx. Pimlico /
      // Alchemy / Stackup already write human-readable messages here
      // ("AA23 reverted: paymaster rejected"), so re-wrapping would
      // only hide signal from the mobile adapter. We map any JSON-RPC
      // code into the 4xx range — bundler-rejected submissions are
      // always caller-side problems (bad signature, nonce collision,
      // insufficient prefund, …) rather than server outages.
      //
      // Status-code selection: the HTTP layer itself already returned
      // 2xx for the JSON-RPC envelope, so we pick 400 by default. A
      // small allowlist (429 → rate-limited by bundler, 402 → payment
      // required) is echoed through as the bundler signaled it.
      const status = pickRejectionHttpStatus(outcome.httpStatus);
      throw new HttpException(
        {
          message: outcome.rpcMessage,
          code: "BUNDLER_REJECTED",
          rpcCode: outcome.rpcCode,
          rpcData: outcome.rpcData,
        },
        status,
      );
    }

    if (outcome.kind === "timeout") {
      this.logger.warn(
        `userOp bundler timeout user=${userId} chainId=${dto.chainId} after ${outcome.message}`,
      );
      throw new GatewayTimeoutException({
        message: "Bundler did not respond within the timeout window.",
        code: "BUNDLER_TIMEOUT",
      });
    }

    // upstream — bundler 5xx, malformed body, network error. Surface as
    // 502 so the mobile adapter can distinguish "try a different chain" /
    // "user action needed" (4xx) from "bundler is down" (5xx).
    this.logger.error(
      `userOp bundler upstream error user=${userId} chainId=${dto.chainId} status=${outcome.httpStatus ?? "n/a"} msg=${outcome.message}`,
    );
    throw new BadGatewayException({
      message: outcome.message || "Bundler upstream error.",
      code: "BUNDLER_UPSTREAM_ERROR",
      bundlerHttpStatus: outcome.httpStatus,
    });
  }

  /**
   * Resolve the bundler URL from DB by chainId, with a short in-process
   * TTL cache so UserOp submits don't round-trip Postgres per request.
   *
   * Returns `null` when no DB row / NULL `bundlerUrl` for the chain —
   * the caller turns that into 400. We deliberately do NOT fall back to
   * a "default" bundler URL because a default would quietly forward
   * traffic for chains the operator never meant to support.
   *
   * The bundler URL currently embeds the provider API key in the query
   * string. See `docs/security_review_needed.md §4` for the planned
   * split of URL ↔ key to a secrets manager.
   */
  private async resolveBundlerUrl(chainId: number): Promise<string | null> {
    const cached = this.bundlerUrlCache.get(chainId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }
    const row = await this.prisma.blockchain.findUnique({
      where: { chainId },
      select: { bundlerUrl: true },
    });
    const url = row?.bundlerUrl?.trim() || null;
    this.bundlerUrlCache.set(chainId, {
      url,
      expiresAt: Date.now() + UserOpService.BUNDLER_URL_CACHE_TTL_MS,
    });
    return url;
  }
}

/**
 * Pick the HTTP status to surface on a bundler JSON-RPC rejection. The
 * JSON-RPC envelope came back over a 2xx HTTP response in the common case
 * (bundlers use JSON-RPC error semantics, not HTTP status codes) — we
 * default to 400 so the mobile adapter's fetch-based polling treats the
 * response as a caller-side problem.
 *
 * If the bundler itself returned 4xx HTTP (rare but possible on rate limit
 * / auth errors), propagate the bundler's intent: 429 stays 429, 401/403
 * gets surfaced as 502 because the mobile never saw the API key anyway —
 * only our server is the bundler's client.
 */
function pickRejectionHttpStatus(bundlerHttpStatus: number): number {
  if (bundlerHttpStatus === 429) return HttpStatus.TOO_MANY_REQUESTS;
  if (bundlerHttpStatus === 401 || bundlerHttpStatus === 403) {
    // The API key is ours, not the user's. Auth errors from the bundler
    // are a server misconfiguration — surface as 502, not 401.
    return HttpStatus.BAD_GATEWAY;
  }
  if (bundlerHttpStatus >= 400 && bundlerHttpStatus < 500) {
    return bundlerHttpStatus;
  }
  // 2xx JSON-RPC errors (the common case) or 5xx with a JSON-RPC error
  // body — default to 400 since the JSON-RPC error is the authoritative
  // signal here.
  return HttpStatus.BAD_REQUEST;
}

/**
 * Defensive field reader — extracts a string field from an unknown object
 * without throwing on shape mismatch. Used only for logging; we never
 * branch program logic on an unchecked field of a client-supplied object.
 */
function readStringField(obj: unknown, field: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[field];
  return typeof v === "string" ? v : null;
}
