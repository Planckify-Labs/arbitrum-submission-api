import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { decryptAccountNumber, redactAccountNumber } from "../account-number-crypto";
import type { IPayoutProviderAdapter } from "../payout-provider.port";
import { getProviderChannel } from "../provider-channel";
import {
  PayoutProviderError,
  type TPayoutReceipt,
  type TProviderStatus,
  type TProviderStatusResult,
} from "../types";

/**
 * Concrete adapter for Xendit's disbursement API.
 *
 * Endpoint: `POST {XENDIT_API_BASE}/v2/payouts` (spec §6.4 — the task file
 * user prompt mentioned `/disbursements`, but the canonical spec §6.4 body
 * shape calls `/v2/payouts`, and `intents.service.ts` + §13 already align
 * on v2. Staying on the spec path keeps us wire-compatible with the
 * webhook contract landing in task 30).
 *
 * Auth: HTTP Basic with the secret key as username, empty password
 * (`Authorization: Basic base64(SECRET:)`) — Xendit's documented convention.
 *
 * Retry discipline (task file §2):
 *   - 60 s per-request timeout via `AbortController`.
 *   - 5xx / network errors / timeouts → exponential backoff, 3 attempts max
 *     (100 ms, 400 ms, 1200 ms).
 *   - 4xx → terminal, no retry — caller persists `FAILED` + message.
 *   - 2xx → return receipt; caller persists `PENDING` and flips intent
 *     to `PAID` on webhook (task 30).
 *
 * Secrets hygiene (§9, task 29 §4):
 *   - API key NEVER appears in logs. `buildAuthHeader` builds once and is
 *     never stringified.
 *   - Account number NEVER appears in logs — only `redactAccountNumber` is
 *     safe to log. The plaintext lives in memory only for the duration of
 *     the request body serialization.
 */
@Injectable()
export class XenditPayoutProvider implements IPayoutProviderAdapter {
  private readonly logger = new Logger(XenditPayoutProvider.name);
  /** Default API base; overridable via `XENDIT_API_BASE` env. */
  private static readonly DEFAULT_API_BASE = "https://api.xendit.co";
  /** 60 s per §2 — Xendit's 99p for `/v2/payouts` is <1 s, generous cap. */
  private static readonly REQUEST_TIMEOUT_MS = 60_000;
  /** Max attempts including the initial call (1 initial + 2 retries). */
  private static readonly MAX_ATTEMPTS = 3;
  /** Base backoff for exponential delay: 100ms, 400ms, 1600ms (4×). */
  private static readonly RETRY_BASE_MS = 100;
  private static readonly RETRY_FACTOR = 4;

  /**
   * Optional HTTP client override — tests inject a mocked `fetch`-shaped
   * function. In production we fall back to global `fetch`. The `@Optional()`
   * decorator is load-bearing: without it Nest's DI container tries to
   * resolve `typeof fetch` as a provider at module boot (TypeScript emits
   * `Function`/`Object` metadata for it) and fails with
   * `UnknownDependenciesException`. Tests pass the override positionally and
   * never touch DI, so the decorator is cost-free for them.
   */
  protected httpFetch: typeof fetch;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() httpFetch?: typeof fetch,
  ) {
    this.httpFetch = httpFetch ?? fetch;
  }

  async triggerPayout(
    intent: PaymentIntent,
    merchant: Merchant,
  ): Promise<TPayoutReceipt> {
    const apiKey = this.requireConfig("XENDIT_SECRET_KEY");
    const apiBase = this.config.get<string>("XENDIT_API_BASE") ?? XenditPayoutProvider.DEFAULT_API_BASE;

    // Resolve the wire channel_code via ProviderChannel. Xendit's Payouts
    // API uses country-prefixed codes (ID_OVO, ID_BCA, …) — different from
    // the canonical merchant-facing code we hold on Merchant. Mirrors the
    // pattern Flip and Duitku already follow.
    const wireChannelCode = await this.resolveWireChannelCode(merchant);

    // Decrypt the merchant's account number just-in-time. NEVER logged in
    // plaintext — only via `redactAccountNumber` for trace readability.
    const accountNumberPlaintext = decryptAccountNumber(merchant.payoutAccountNumber);
    const redacted = redactAccountNumber(accountNumberPlaintext);

    // `external_id` / `reference_id` == intent.id. Xendit's
    // `Idempotency-key` header is also set to the intent id so retries on
    // our side don't double-disburse on theirs. Spec §6.4 locks this in.
    const referenceId = intent.id;

    // Amount must be an integer (IDR has no sub-unit in Xendit's wire
    // shape — fiatAmountMinor is already integer rupiah per §6.6).
    const amount = intent.fiatAmountMinor;

    const body = {
      reference_id: referenceId,
      channel_code: wireChannelCode,
      channel_properties: {
        account_number: accountNumberPlaintext,
        account_holder_name: merchant.payoutAccountHolderName,
      },
      amount,
      currency: intent.fiatCurrency,
      description: `TakumiPay payout intent ${intent.id}`,
    };

    const url = `${apiBase.replace(/\/$/, "")}/v2/payouts`;
    const headers: Record<string, string> = {
      // base64(secretKey + ":") — Xendit's convention. We intentionally
      // don't store the encoded value on the instance; keeps it out of
      // heap dumps / error logs.
      Authorization: `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`,
      "Idempotency-key": referenceId,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    this.logger.log(
      `Xendit payout attempt intentId=${intent.id} channel=${merchant.payoutChannelCode} amount=${amount} ${intent.fiatCurrency} account=${redacted}`,
    );

    // Attempt loop with exponential backoff on transient failures only.
    let lastErr: PayoutProviderError | null = null;
    for (let attempt = 1; attempt <= XenditPayoutProvider.MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.postOnce(url, headers, body);
        const status = this.mapXenditStatus(
          typeof result.body === "object" && result.body !== null
            ? ((result.body as Record<string, unknown>).status as string | undefined)
            : undefined,
        );
        return {
          referenceId,
          providerPayoutId:
            typeof result.body === "object" && result.body !== null
              ? ((result.body as Record<string, unknown>).id as string | undefined) ?? null
              : null,
          status,
          amount,
          currency: intent.fiatCurrency,
          channelCode: merchant.payoutChannelCode,
          requestedAt: new Date(),
          rawResponse: result.body,
        };
      } catch (err) {
        if (!(err instanceof PayoutProviderError)) {
          // Guard — shouldn't happen; postOnce always throws PayoutProviderError.
          throw err;
        }
        lastErr = err;
        if (err.kind === "client_error") {
          // 4xx is terminal. Surface immediately — caller writes FAILED row.
          this.logger.warn(
            `Xendit payout 4xx (terminal) intentId=${intent.id} status=${err.httpStatus} message=${err.message}`,
          );
          throw err;
        }
        if (attempt >= XenditPayoutProvider.MAX_ATTEMPTS) break;
        const delayMs =
          XenditPayoutProvider.RETRY_BASE_MS *
          XenditPayoutProvider.RETRY_FACTOR ** (attempt - 1);
        this.logger.warn(
          `Xendit payout transient failure intentId=${intent.id} kind=${err.kind} attempt=${attempt}/${XenditPayoutProvider.MAX_ATTEMPTS} retryInMs=${delayMs}`,
        );
        await sleep(delayMs);
      }
    }

    // Fell through every retry — surface the last error so caller persists FAILED.
    throw (
      lastErr ??
      new PayoutProviderError({
        message: "Xendit payout: exhausted retries with no captured error",
        kind: "unknown",
        httpStatus: null,
        rawResponse: null,
      })
    );
  }

  async getStatus(_providerReferenceId: string): Promise<TProviderStatusResult> {
    // v1 deliberately stubs this to PENDING — webhook (task 30) is the
    // source of truth for status transitions. Leaving a concrete reconcile
    // call for a future task (49 refund runbook) once Xendit's
    // `GET /v2/payouts/{id}` contract is locked.
    return { status: "PENDING" };
  }

  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    _body: string,
  ): boolean {
    const expected = this.config.get<string>("XENDIT_WEBHOOK_TOKEN");
    if (!expected) {
      // Fail closed — missing config is a deployment bug, never trust the caller.
      this.logger.error("XENDIT_WEBHOOK_TOKEN missing — rejecting webhook.");
      return false;
    }
    const raw = headers["x-callback-token"];
    const received = Array.isArray(raw) ? raw[0] : raw;
    if (!received || typeof received !== "string") return false;

    // Timing-safe compare — both buffers must be the same length, so we
    // pad/truncate to the expected length's byte size. Mismatched lengths
    // return false directly.
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Single round-trip to Xendit with a 60 s timeout. Maps wire outcomes
   * onto `PayoutProviderError` with the right `kind` so the caller's retry
   * logic can branch cleanly.
   */
  private async postOnce(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      XenditPayoutProvider.REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await this.httpFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        parsed = { rawText: text };
      }

      if (response.status >= 200 && response.status < 300) {
        return { status: response.status, body: parsed };
      }
      if (response.status >= 400 && response.status < 500) {
        throw new PayoutProviderError({
          message: `Xendit ${response.status}: ${this.extractErrorMessage(parsed)}`,
          kind: "client_error",
          httpStatus: response.status,
          rawResponse: parsed,
        });
      }
      // 5xx / everything else
      throw new PayoutProviderError({
        message: `Xendit ${response.status}: ${this.extractErrorMessage(parsed)}`,
        kind: "server_error",
        httpStatus: response.status,
        rawResponse: parsed,
      });
    } catch (err) {
      if (err instanceof PayoutProviderError) throw err;
      // AbortError from the timeout — Node names it `AbortError` (name)
      // or `DOMException` depending on runtime. Check both.
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" ||
          (typeof (err as { code?: string }).code === "string" &&
            (err as { code?: string }).code === "ABORT_ERR"));
      if (isAbort) {
        throw new PayoutProviderError({
          message: `Xendit payout request timed out after ${XenditPayoutProvider.REQUEST_TIMEOUT_MS}ms`,
          kind: "timeout",
          httpStatus: null,
          rawResponse: null,
        });
      }
      throw new PayoutProviderError({
        message: `Xendit payout network error: ${err instanceof Error ? err.message : String(err)}`,
        kind: "server_error",
        httpStatus: null,
        rawResponse: null,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Pull an error message out of Xendit's JSON envelope. Xendit returns
   * `{ error_code, message }` on most failures; fall back to stringifying
   * the whole object for unknown shapes.
   */
  private extractErrorMessage(parsed: unknown): string {
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const msg = obj.message ?? obj.error_code ?? obj.reason ?? obj.description;
      if (typeof msg === "string") return msg;
    }
    return typeof parsed === "string" ? parsed : "unknown error";
  }

  /**
   * Map Xendit's `status` field onto our `TProviderStatus` enum. Xendit
   * documents `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `EXPIRED`,
   * `CANCELLED` — we collapse the terminal-failure flavours onto `FAILED`.
   * Unknown values default to `PENDING` (webhook will reconcile).
   */
  private mapXenditStatus(raw: string | undefined): TProviderStatus {
    switch ((raw ?? "").toUpperCase()) {
      case "COMPLETED":
      case "SUCCEEDED":
        return "COMPLETED";
      case "PROCESSING":
        return "PROCESSING";
      case "FAILED":
      case "EXPIRED":
      case "CANCELLED":
      case "CANCELED":
        return "FAILED";
      case "PENDING":
      case "":
      default:
        return "PENDING";
    }
  }

  private async resolveWireChannelCode(merchant: Merchant): Promise<string> {
    if (!this.prisma) {
      throw new PayoutProviderError({
        message: "PrismaService not injected into XenditPayoutProvider",
        kind: "unknown",
        httpStatus: null,
        rawResponse: null,
      });
    }
    const pc = await getProviderChannel(
      this.prisma,
      merchant,
      merchant.payoutChannelCode,
    );
    if (!pc) {
      throw new PayoutProviderError({
        message: `Missing ProviderChannel row for (${merchant.payoutChannelCode}, ${merchant.country}, xendit). Seed the row before enabling Xendit for this merchant.`,
        kind: "client_error",
        httpStatus: null,
        rawResponse: null,
      });
    }
    return pc.providerChannelCode;
  }

  private requireConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new PayoutProviderError({
        message: `Missing required env var ${key}`,
        kind: "unknown",
        httpStatus: null,
        rawResponse: null,
      });
    }
    return value;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
