import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Circle x402 Solana facilitator settle client (spec §5.2.1 Path B-SVM).
 *
 * Shape mirrors {@link CircleSettleClient} (EVM) so the service layer treats
 * the two flows symmetrically — one DI token per namespace, same four-kind
 * outcome union. We intentionally keep the body opaque (`signedTransaction`
 * passthrough) on this side: backend does NOT parse the Solana tx bytes
 * (`@solana/web3.js` isn't a backend dep per task 43 Constraints) — we just
 * forward whatever the mobile signer emitted.
 *
 * Endpoint selection (task 43 §Scope #2): the target URL is driven by
 * `CIRCLE_X402_SVM_FACILITATOR_URL`. Ops flips that between Circle's
 * `/gateway/v1/x402/settle` (if Circle lists `solana:*` at boot) and a
 * Solana-compatible external facilitator (Coinbase CDP, rapid402, self-host)
 * based on the M6 kickoff decision (spec §12 Q7). Switching is a deploy-time
 * config change, NOT a code change — chain-extension discipline (memory
 * `feedback_chain_extension_discipline.md`).
 *
 * RFC: github.com/coinbase/x402/issues/646 (SVM scheme stability). If the
 * wire format drifts pre-M6, the opaque-forward posture here limits the blast
 * radius to this file — mobile signer (task 42) is the other load-bearing
 * piece.
 */

/**
 * Request envelope forwarded to the SVM facilitator. Mobile (task 42)
 * produces a base64-encoded partially-signed Solana versioned transaction
 * carrying ComputeBudget + TransferChecked (+ optional Memo) instructions.
 * The facilitator adds the fee-payer signature and submits to Solana.
 */
export interface CircleSettleSvmRequest {
  /** Base64-encoded signed Solana transaction. Opaque to our proxy. */
  signedTransaction: string;
  /**
   * Optional payment-requirements echo. The spec §5.2.1 body shape carries
   * `{ scheme, network, asset, payTo, amount, maxTimeoutSeconds, extra:{ feePayer } }`
   * when Circle's settle endpoint is in play; for a permissionless external
   * facilitator the transaction itself already encodes everything. We let
   * the service populate this from the persisted intent + x402-supported
   * cache and forward as-is.
   */
  paymentRequirements?: unknown;
}

export interface CircleSettleSvmSuccess {
  success: true;
  /** Solana transaction signature (base58) once the facilitator confirms. */
  transaction: string;
  /** CAIP-2 network string (e.g. `solana:mainnet`). */
  network: string;
  /** Payer pubkey (base58) if the facilitator echoes it back. */
  payer?: string;
}

export interface CircleSettleSvmFailure {
  success: false;
  /** Machine-readable failure enum mirrored from the EVM client. */
  errorReason?: string;
  /** Free-form upstream detail. */
  message?: string;
  /** Optional tx signature if the facilitator surfaces a partial attempt. */
  transaction?: string;
  network?: string;
}

export type CircleSettleSvmResponse =
  | CircleSettleSvmSuccess
  | CircleSettleSvmFailure;

/**
 * Four-branch outcome union — identical semantics to the EVM client so the
 * service layer reuses the same `persistOutcome` state-machine (each branch
 * has a distinct DB-side consequence and callers MUST handle all four).
 */
export type CircleSettleSvmOutcome =
  | { kind: "ok"; response: CircleSettleSvmSuccess; rawBody: unknown }
  | {
      kind: "rejected";
      status: number;
      response: CircleSettleSvmFailure;
      rawBody: unknown;
    }
  | { kind: "upstream"; status: number | null; rawBody: unknown; message: string }
  | { kind: "timeout"; message: string };

export interface ICircleSettleSvmClient {
  settle(
    body: CircleSettleSvmRequest,
    signal?: AbortSignal,
  ): Promise<CircleSettleSvmOutcome>;
}

/** DI token — lets tests inject a stub without mocking global `fetch`. */
export const CIRCLE_SETTLE_SVM_CLIENT = "CIRCLE_SETTLE_SVM_CLIENT";

/**
 * Same timeout band as the EVM client — SVM facilitators tend to be faster
 * (Solana finality dominates at ~400 ms), but we keep 30 s to absorb
 * cross-region latency spikes without flapping every blip.
 */
export const CIRCLE_SETTLE_SVM_TIMEOUT_MS = 30_000;

@Injectable()
export class CircleSettleSvmClient implements ICircleSettleSvmClient {
  private readonly logger = new Logger(CircleSettleSvmClient.name);
  private readonly url: string | undefined;
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    // Full URL — the path is baked in because different facilitators use
    // different paths. Circle uses `/gateway/v1/x402/settle`; an external
    // facilitator may expose `/settle` or `/v1/payment/settle`. One env, no
    // path concatenation in code.
    const raw = this.config.get<string>("CIRCLE_X402_SVM_FACILITATOR_URL");
    this.url = raw && raw.trim().length > 0 ? raw.trim() : undefined;
    this.apiKey = this.config.get<string>("CIRCLE_API_KEY") || undefined;
  }

  async settle(
    body: CircleSettleSvmRequest,
    parentSignal?: AbortSignal,
  ): Promise<CircleSettleSvmOutcome> {
    if (!this.url) {
      // Pre-M6 posture (task 43 Rules): env may remain blank. Surface as an
      // upstream error so the caller flips the intent to FAILED with a
      // typed code; NOT a throw — mobile gets a structured response.
      return {
        kind: "upstream",
        status: null,
        rawBody: null,
        message:
          "CIRCLE_X402_SVM_FACILITATOR_URL is not configured; SVM settle path is disabled.",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      CIRCLE_SETTLE_SVM_TIMEOUT_MS,
    );
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
      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = response.status;

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        return {
          kind: "upstream",
          status,
          rawBody: null,
          message: `SVM facilitator returned non-JSON (HTTP ${status})`,
        };
      }

      if (response.ok && isSettleSuccess(parsed)) {
        return { kind: "ok", response: parsed, rawBody: parsed };
      }

      if (response.status >= 400 && response.status < 500) {
        return {
          kind: "rejected",
          status,
          response: coerceFailure(parsed),
          rawBody: parsed,
        };
      }

      if (response.ok && isSettleFailure(parsed)) {
        return {
          kind: "rejected",
          status,
          response: coerceFailure(parsed),
          rawBody: parsed,
        };
      }

      return {
        kind: "upstream",
        status,
        rawBody: parsed,
        message: `SVM facilitator ${response.status} ${response.statusText}`,
      };
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || controller.signal.aborted);
      if (isAbort) {
        return {
          kind: "timeout",
          message: `SVM facilitator timed out after ${CIRCLE_SETTLE_SVM_TIMEOUT_MS}ms`,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "upstream", status, rawBody: null, message };
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }
}

function isSettleSuccess(value: unknown): value is CircleSettleSvmSuccess {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.success === true &&
    typeof v.transaction === "string" &&
    typeof v.network === "string"
  );
}

function isSettleFailure(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.success === false;
}

function coerceFailure(value: unknown): CircleSettleSvmFailure {
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
