/**
 * Backend DeFi error taxonomy.
 *
 * Spec: docs/defi-strategies-spec.md §16.
 *
 * Backend services throw `DefiError("<code>")` instead of embedding
 * external response bodies. The `DefiErrorFilter` translates these
 * into HTTP responses with body `{ error: "defi_<code>" }` so the
 * mobile classifier can map deterministically without ever stringifying
 * an HTTP body.
 *
 * For external clients (Zerion, DeFiLlama, DeBank, LI.FI) — wrap
 * upstream failures with `DefiError("network_error")` and log the
 * raw body separately. NEVER let an upstream response body land in a
 * thrown `Error.message`.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

export const DEFI_ERROR_CODES = [
  "insufficient_funds",
  "tier_exceeds_user_policy",
  "protocol_not_in_whitelist",
  "protocol_not_found",
  "unsupported_chain",
  "unsupported_asset",
  "below_min_deposit",
  "above_max_deposit",
  "approval_required",
  "approval_failed",
  "deposit_failed",
  "withdraw_failed",
  "claim_failed",
  "rebalance_failed",
  "rebalance_partial_failure",
  "apy_drift_too_high",
  "strategy_paused",
  "strategy_not_configured",
  "position_not_found",
  "cooldown_in_progress",
  "cooldown_not_started",
  "no_claimable_balance",
  "wallet_cannot_execute",
  "network_error",
  "rate_limited",
  "user_cancelled",
  "unauthorized",
  // ── EVM protocol expansion (docs/defi-evm-protocol-expansion-spec.md §11.2)
  // Mirrors `DefiErrorCode` in mobile-app/services/defi/errors/defiErrors.ts:
  // the filter emits `defi_<code>` and the mobile classifier passes it through,
  // so a code missing on either side degrades silently to "unknown".
  "target_not_a_contract",
  "target_not_allowlisted",
  "market_id_mismatch",
  "oracle_not_allowlisted",
  "deposit_cap_exceeded",
  "slippage_too_high",
  "quote_expired",
  "protocol_paused",
  "decoded_intent_mismatch",
  "exposure_cap_exceeded",
  "family_disabled",
  "decimals_mismatch",
  "counterparty_blocked",
  "awaiting_finality",
  "duplicate_submission",
  "velocity_exceeded",
  "pool_anomaly_flagged",
  // ── DCA v1 (mobile-app docs/defi-quick-invest-spec.md §12)
  "plan_not_found",
  "unknown",
] as const;

export type DefiErrorCode = (typeof DEFI_ERROR_CODES)[number];

/**
 * Typed HTTP exception carrying a curated DeFi error code. Throw
 * inside services / external clients with a short `code` and an
 * optional `detail` argument. `detail` is logged but never propagated
 * to the response body.
 */
export class DefiError extends HttpException {
  public readonly code: DefiErrorCode;
  public readonly detail?: string;

  constructor(code: DefiErrorCode, detail?: string, status?: HttpStatus) {
    super({ error: `defi_${code}` }, status ?? mapCodeToStatus(code));
    this.code = code;
    this.detail = detail;
  }
}

function mapCodeToStatus(code: DefiErrorCode): HttpStatus {
  switch (code) {
    case "unauthorized":
      return HttpStatus.UNAUTHORIZED;
    case "protocol_not_found":
    case "position_not_found":
    case "strategy_not_configured":
      return HttpStatus.NOT_FOUND;
    case "rate_limited":
      return HttpStatus.TOO_MANY_REQUESTS;
    case "network_error":
      return HttpStatus.BAD_GATEWAY;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Global exception filter for the strategies module. Catches both
 * `DefiError` (already typed) and any other thrown error (maps to
 * `defi_unknown` and logs the raw detail).
 *
 * Wire in via `app.useGlobalFilters(new DefiErrorFilter())` or per
 * controller `@UseFilters(DefiErrorFilter)`.
 */
@Catch()
export class DefiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DefiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url?: string }>();

    if (exception instanceof DefiError) {
      this.logger.warn(
        `[${request?.url ?? "unknown"}] defi_${exception.code}${
          exception.detail ? ` — ${exception.detail}` : ""
        }`,
      );
      response.status(exception.getStatus()).json({
        error: `defi_${exception.code}`,
      });
      return;
    }

    if (exception instanceof HttpException) {
      // Translate NestJS built-in exceptions to a curated code.
      const status = exception.getStatus();
      const code = httpStatusToDefiCode(status);
      this.logger.warn(
        `[${request?.url ?? "unknown"}] httpException ${status} → defi_${code}: ${
          exception.message
        }`,
      );
      response.status(status).json({ error: `defi_${code}` });
      return;
    }

    // Unknown thrown — log raw but never echo to the client.
    const detail =
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception);
    this.logger.error(
      `[${request?.url ?? "unknown"}] uncaught error: ${detail}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: "defi_unknown",
    });
  }
}

function httpStatusToDefiCode(status: number): DefiErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return "unauthorized";
    case HttpStatus.NOT_FOUND:
      return "protocol_not_found";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "rate_limited";
    case HttpStatus.BAD_GATEWAY:
    case HttpStatus.GATEWAY_TIMEOUT:
      return "network_error";
    default:
      return "unknown";
  }
}
