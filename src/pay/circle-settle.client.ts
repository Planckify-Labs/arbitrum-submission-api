import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Shape of Circle Gateway `POST /gateway/v1/x402/settle` as used by our
 * proxy. We only model the fields we actually read — `transaction`,
 * `network`, `payer`, `errorReason` — and let unknowns flow through.
 *
 * The OpenAPI is larger (see spec §6.5), but stitching a full Circle type
 * tree buys us nothing here: we forward an opaque `paymentPayload` +
 * `paymentRequirements` envelope and only parse what we need out of the
 * response.
 */
export interface CircleSettleRequest {
  /** The signed EIP-3009 x402 `PaymentPayload`. Opaque to our proxy. */
  paymentPayload: unknown;
  /** The `PaymentRequirements` envelope the mobile echoed from the intent. */
  paymentRequirements: unknown;
}

export interface CircleSettleSuccess {
  success: true;
  /** UUID of the Circle-assigned settlement transaction. */
  transaction: string;
  /** CAIP-2 network string Circle settled on (e.g. `eip155:5042002`). */
  network: string;
  payer?: string;
}

export interface CircleSettleFailure {
  success: false;
  /** Circle's machine-readable failure enum — mapped to our
   *  `NanopayFailureCode` at the service layer. */
  errorReason?: string;
  /** Free-form upstream detail. Circle sometimes includes this. */
  message?: string;
  /** The same `transaction` field may be present on 4xx so we can still
   *  audit-link if Circle surfaces one. */
  transaction?: string;
  /** CAIP-2 network string if Circle echoes it back. */
  network?: string;
}

export type CircleSettleResponse = CircleSettleSuccess | CircleSettleFailure;

/**
 * Distinguishes the three outcomes the caller cares about:
 *   - `ok`          — Circle returned 2xx with `success: true`.
 *   - `rejected`    — Circle returned 2xx/4xx with `success: false` or a
 *                     4xx with a parseable body. Intent → `FAILED`.
 *   - `upstream`    — 5xx / malformed body / non-timeout network error.
 *                     Intent → `FAILED` with a `CIRCLE_UPSTREAM_ERROR`.
 *   - `timeout`     — AbortError fired after `CIRCLE_SETTLE_TIMEOUT_MS`.
 *                     Intent → `SETTLING` (in-flight, retry-safe).
 *
 * We surface this as a discriminated union rather than throwing exceptions
 * because every branch has a distinct DB-side consequence and callers
 * MUST handle all four.
 */
export type CircleSettleOutcome =
  | { kind: "ok"; response: CircleSettleSuccess; rawBody: unknown }
  | { kind: "rejected"; status: number; response: CircleSettleFailure; rawBody: unknown }
  | { kind: "upstream"; status: number | null; rawBody: unknown; message: string }
  | { kind: "timeout"; message: string };

/**
 * Circle Gateway settle is declared `security: []` in its OpenAPI — no key
 * required. We still accept `CIRCLE_API_KEY` as an optional env so prod
 * deployments that want attestation-dashboard coverage can flip it on
 * without a code change (spec §13 "Circle Gateway + Nanopayments" ②:
 * *"Optional: generate `CIRCLE_API_KEY` if you want the Developer Console
 * …  Not on the critical path for v1."*).
 *
 * Bottom line: send `Authorization: Bearer …` iff the env is set, else
 * hit the permissionless endpoint.
 */
export interface ICircleSettleClient {
  settle(
    body: CircleSettleRequest,
    signal?: AbortSignal,
  ): Promise<CircleSettleOutcome>;
}

/** DI token for the Circle settle client so tests can inject a stub. */
export const CIRCLE_SETTLE_CLIENT = "CIRCLE_SETTLE_CLIENT";

/** Default Circle Gateway testnet base. Overridable via env. */
export const DEFAULT_CIRCLE_GATEWAY_API = "https://gateway-api-testnet.circle.com";

/**
 * Per user-prompt scope item 2 (timeouts): "Circle call: 30s timeout. If
 * timeout, mark intent status SETTLING (in-flight, retry-safe)." That's
 * longer than Circle's ~500 ms p99 but absorbs cross-region latency spikes
 * without tripping on every blip.
 */
export const CIRCLE_SETTLE_TIMEOUT_MS = 30_000;

/** Circle's x402 settle path — locked by the OpenAPI (spec §6.5). */
export const CIRCLE_SETTLE_PATH = "/gateway/v1/x402/settle";

@Injectable()
export class CircleSettleClient implements ICircleSettleClient {
  private readonly logger = new Logger(CircleSettleClient.name);
  private readonly base: string;
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.base = this.config
      .get<string>("CIRCLE_GATEWAY_API", DEFAULT_CIRCLE_GATEWAY_API)
      .replace(/\/+$/, "");
    // Optional. Omitted on the hot path by default; present only if ops
    // wants Circle Console coverage (spec §13).
    this.apiKey = this.config.get<string>("CIRCLE_API_KEY") || undefined;
  }

  async settle(
    body: CircleSettleRequest,
    parentSignal?: AbortSignal,
  ): Promise<CircleSettleOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CIRCLE_SETTLE_TIMEOUT_MS);

    // Chain the caller's abort (e.g. module destroy) → our controller so
    // shutting the pod cancels in-flight settles cleanly.
    const onParentAbort = () => controller.abort();
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let status: number | null = null;
    try {
      const response = await fetch(`${this.base}${CIRCLE_SETTLE_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = response.status;

      // Parse body regardless of status — Circle returns structured
      // `errorReason` JSON on 4xx, which the caller needs for mapping.
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        // Non-JSON response — treat as upstream error.
        return {
          kind: "upstream",
          status,
          rawBody: null,
          message: `Circle settle returned non-JSON (HTTP ${status})`,
        };
      }

      if (response.ok && isSettleSuccess(parsed)) {
        return { kind: "ok", response: parsed, rawBody: parsed };
      }

      // 2xx with `success: false`, or 4xx with parseable body → treat as
      // a "rejected" outcome so we can map the error to a
      // NanopayFailureCode and persist FAILED.
      if (response.status >= 400 && response.status < 500) {
        const failure = coerceFailure(parsed);
        return { kind: "rejected", status, response: failure, rawBody: parsed };
      }

      // Some Gateways return 200 with `success: false` — still a rejection.
      if (response.ok && isSettleFailure(parsed)) {
        const failure = coerceFailure(parsed);
        return { kind: "rejected", status, response: failure, rawBody: parsed };
      }

      // 5xx or otherwise malformed — upstream outage. Caller writes
      // CIRCLE_UPSTREAM_ERROR.
      return {
        kind: "upstream",
        status,
        rawBody: parsed,
        message: `Circle settle ${response.status} ${response.statusText}`,
      };
    } catch (err) {
      // AbortError == our timeout. Caller maps to SETTLING.
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || controller.signal.aborted);
      if (isAbort) {
        return {
          kind: "timeout",
          message: `Circle settle timed out after ${CIRCLE_SETTLE_TIMEOUT_MS}ms`,
        };
      }
      // Network error / DNS / TLS — treat as upstream outage.
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "upstream", status, rawBody: null, message };
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }
}

function isSettleSuccess(value: unknown): value is CircleSettleSuccess {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.success === true && typeof v.transaction === "string" && typeof v.network === "string";
}

function isSettleFailure(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.success === false;
}

function coerceFailure(value: unknown): CircleSettleFailure {
  if (!value || typeof value !== "object") {
    return { success: false };
  }
  const v = value as Record<string, unknown>;
  return {
    success: false,
    errorReason: typeof v.errorReason === "string" ? v.errorReason : undefined,
    message: typeof v.message === "string" ? v.message : undefined,
    transaction: typeof v.transaction === "string" ? v.transaction : undefined,
    network: typeof v.network === "string" ? v.network : undefined,
  };
}
