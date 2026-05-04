import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { decryptAccountNumber, redactAccountNumber } from "../account-number-crypto";
import type { IPayoutProviderAdapter } from "../payout-provider.port";
import { getProviderChannel } from "../provider-channel";
import {
  PayoutProviderError,
  type TPayoutReceipt,
  type TProviderStatus,
  type TProviderStatusResult,
} from "../types";

interface FlipCredentials {
  secretKey: string;
  validationToken: string;
  apiBase: string;
}

@Injectable()
export class FlipPayoutProvider implements IPayoutProviderAdapter {
  private readonly logger = new Logger(FlipPayoutProvider.name);
  private static readonly REQUEST_TIMEOUT_MS = 60_000;
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly RETRY_BASE_MS = 100;
  private static readonly RETRY_FACTOR = 4;

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
    const creds = this.requireConfig();
    const bankCode = await this.resolveBankCode(merchant);
    const accountNumberPlaintext = decryptAccountNumber(
      merchant.payoutAccountNumber,
    );
    const redacted = redactAccountNumber(accountNumberPlaintext);

    const referenceId = intent.id;
    const amount = intent.fiatAmountMinor;
    const remark = intent.id.slice(-18);

    this.logger.log(
      `Flip payout attempt intentId=${intent.id} channel=${merchant.payoutChannelCode} bankCode=${bankCode} amount=${amount} ${intent.fiatCurrency} account=${redacted}`,
    );

    const formParams: Record<string, string | number> = {
      account_number: accountNumberPlaintext,
      bank_code: bankCode,
      amount,
      remark,
    };

    const url = `${trim(creds.apiBase)}/disbursement`;
    const headers: Record<string, string> = {
      Authorization: this.buildAuthHeader(creds.secretKey),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "idempotency-key": referenceId,
    };

    let lastErr: PayoutProviderError | null = null;
    for (let attempt = 1; attempt <= FlipPayoutProvider.MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.postOnce(
          url,
          headers,
          this.buildFormBody(formParams),
        );
        const body =
          result.body && typeof result.body === "object"
            ? (result.body as Record<string, unknown>)
            : {};
        const status = this.mapFlipStatus(body.status as string | undefined);
        return {
          referenceId,
          providerPayoutId:
            body.id != null ? String(body.id) : null,
          status,
          amount,
          currency: intent.fiatCurrency,
          channelCode: merchant.payoutChannelCode,
          requestedAt: new Date(),
          providerResponseCode: (body.status as string) ?? null,
          rawResponse: result.body,
        };
      } catch (err) {
        if (!(err instanceof PayoutProviderError)) throw err;
        lastErr = err;
        if (err.kind === "client_error") throw err;
        if (attempt >= FlipPayoutProvider.MAX_ATTEMPTS) break;
        const delayMs =
          FlipPayoutProvider.RETRY_BASE_MS *
          FlipPayoutProvider.RETRY_FACTOR ** (attempt - 1);
        this.logger.warn(
          `Flip payout transient failure intentId=${intent.id} kind=${err.kind} attempt=${attempt}/${FlipPayoutProvider.MAX_ATTEMPTS} retryInMs=${delayMs}`,
        );
        await sleep(delayMs);
      }
    }

    throw (
      lastErr ??
      new PayoutProviderError({
        message: "Flip payout: exhausted retries with no captured error",
        kind: "unknown",
        httpStatus: null,
        rawResponse: null,
      })
    );
  }

  async getStatus(
    providerReferenceId: string,
  ): Promise<TProviderStatusResult> {
    const creds = this.requireConfig();
    const url = `${trim(creds.apiBase)}/disbursement/${providerReferenceId}`;
    const headers: Record<string, string> = {
      Authorization: this.buildAuthHeader(creds.secretKey),
      Accept: "application/json",
    };

    let lastErr: PayoutProviderError | null = null;
    for (let attempt = 1; attempt <= FlipPayoutProvider.MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.getOnce(url, headers);
        const body =
          result.body && typeof result.body === "object"
            ? (result.body as Record<string, unknown>)
            : {};
        const status = this.mapFlipStatus(body.status as string | undefined);
        return {
          status,
          providerResponseCode: (body.status as string) ?? null,
          providerResponseBody: result.body,
        };
      } catch (err) {
        if (!(err instanceof PayoutProviderError)) throw err;
        lastErr = err;
        if (err.kind === "client_error") throw err;
        if (attempt >= FlipPayoutProvider.MAX_ATTEMPTS) break;
        const delayMs =
          FlipPayoutProvider.RETRY_BASE_MS *
          FlipPayoutProvider.RETRY_FACTOR ** (attempt - 1);
        this.logger.warn(
          `Flip getStatus transient failure id=${providerReferenceId} kind=${err.kind} attempt=${attempt}/${FlipPayoutProvider.MAX_ATTEMPTS} retryInMs=${delayMs}`,
        );
        await sleep(delayMs);
      }
    }

    throw (
      lastErr ??
      new PayoutProviderError({
        message: "Flip getStatus: exhausted retries with no captured error",
        kind: "unknown",
        httpStatus: null,
        rawResponse: null,
      })
    );
  }

  /**
   * Reconcile fallback — look up a disbursement by the idempotency key
   * we originally sent (which is `intent.id`). Useful when
   * `providerPayoutId` is null because we never received the create
   * response due to a network failure.
   *
   * NOT on `IPayoutProviderAdapter` — Flip-specific utility.
   */
  async getStatusByIdempotencyKey(
    intentId: string,
  ): Promise<TProviderStatusResult & { providerPayoutId: string | null }> {
    const creds = this.requireConfig();
    const url = `${trim(creds.apiBase)}/disbursement?idempotency_key=${encodeURIComponent(intentId)}`;
    const headers: Record<string, string> = {
      Authorization: this.buildAuthHeader(creds.secretKey),
      Accept: "application/json",
    };

    const result = await this.getOnce(url, headers);
    const body =
      result.body && typeof result.body === "object"
        ? (result.body as Record<string, unknown>)
        : {};
    const status = this.mapFlipStatus(body.status as string | undefined);
    return {
      status,
      providerResponseCode: (body.status as string) ?? null,
      providerResponseBody: result.body,
      providerPayoutId: body.id != null ? String(body.id) : null,
    };
  }

  /**
   * Ops helper — read the Flip Business balance. NOT on the port
   * interface (same pattern as Duitku's `checkBalance`).
   */
  async checkBalance(): Promise<{ balance: number }> {
    const creds = this.requireConfig();
    const url = `${trim(creds.apiBase)}/general/balance`;
    const headers: Record<string, string> = {
      Authorization: this.buildAuthHeader(creds.secretKey),
      Accept: "application/json",
    };

    const result = await this.getOnce(url, headers);
    const body =
      result.body && typeof result.body === "object"
        ? (result.body as Record<string, unknown>)
        : {};
    const balanceRaw = body.balance;
    const balance =
      typeof balanceRaw === "number"
        ? balanceRaw
        : typeof balanceRaw === "string"
          ? Number(balanceRaw)
          : NaN;
    if (!Number.isFinite(balance)) {
      throw new PayoutProviderError({
        message: "Flip checkBalance: missing/invalid balance in response",
        kind: "server_error",
        httpStatus: null,
        rawResponse: result.body,
      });
    }
    this.logger.log(`Flip balance=${balance} currency=IDR`);
    return { balance };
  }

  verifyWebhookSignature(
    _headers: Record<string, string | string[] | undefined>,
    body: string,
  ): boolean {
    const expected = this.config.get<string>("FLIP_VALIDATION_TOKEN");
    if (!expected) {
      this.logger.error(
        "FLIP_VALIDATION_TOKEN missing — rejecting webhook.",
      );
      return false;
    }

    let token: string | undefined;
    try {
      const params = new URLSearchParams(body);
      token = params.get("token") ?? undefined;
    } catch {
      token = undefined;
    }

    if (!token) return false;

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(token, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  // --- private helpers ---

  private buildAuthHeader(secretKey: string): string {
    return `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`;
  }

  private buildFormBody(params: Record<string, string | number>): string {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      form.append(key, String(value));
    }
    return form.toString();
  }

  private mapFlipStatus(raw: string | undefined): TProviderStatus {
    switch ((raw ?? "").toUpperCase()) {
      case "DONE":
        return "COMPLETED";
      case "CANCELLED":
        return "FAILED";
      case "PENDING":
      default:
        return "PENDING";
    }
  }

  private async resolveBankCode(merchant: Merchant): Promise<string> {
    if (!this.prisma) {
      throw new PayoutProviderError({
        message: "PrismaService not injected into FlipPayoutProvider",
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
        message: `Missing ProviderChannel row for (${merchant.payoutChannelCode}, ${merchant.country}, flip). Seed the row before enabling Flip for this merchant.`,
        kind: "client_error",
        httpStatus: null,
        rawResponse: null,
      });
    }
    return pc.providerChannelCode;
  }

  private async postOnce(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      FlipPayoutProvider.REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await this.httpFetch(url, {
        method: "POST",
        headers,
        body,
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
          message: `Flip ${response.status}: ${this.extractErrorMessage(parsed)}`,
          kind: "client_error",
          httpStatus: response.status,
          rawResponse: parsed,
        });
      }
      throw new PayoutProviderError({
        message: `Flip ${response.status}: ${this.extractErrorMessage(parsed)}`,
        kind: "server_error",
        httpStatus: response.status,
        rawResponse: parsed,
      });
    } catch (err) {
      if (err instanceof PayoutProviderError) throw err;
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" ||
          (typeof (err as { code?: string }).code === "string" &&
            (err as { code?: string }).code === "ABORT_ERR"));
      if (isAbort) {
        throw new PayoutProviderError({
          message: `Flip request timed out after ${FlipPayoutProvider.REQUEST_TIMEOUT_MS}ms`,
          kind: "timeout",
          httpStatus: null,
          rawResponse: null,
        });
      }
      throw new PayoutProviderError({
        message: `Flip network error: ${err instanceof Error ? err.message : String(err)}`,
        kind: "server_error",
        httpStatus: null,
        rawResponse: null,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getOnce(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      FlipPayoutProvider.REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await this.httpFetch(url, {
        method: "GET",
        headers,
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
          message: `Flip ${response.status}: ${this.extractErrorMessage(parsed)}`,
          kind: "client_error",
          httpStatus: response.status,
          rawResponse: parsed,
        });
      }
      throw new PayoutProviderError({
        message: `Flip ${response.status}: ${this.extractErrorMessage(parsed)}`,
        kind: "server_error",
        httpStatus: response.status,
        rawResponse: parsed,
      });
    } catch (err) {
      if (err instanceof PayoutProviderError) throw err;
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" ||
          (typeof (err as { code?: string }).code === "string" &&
            (err as { code?: string }).code === "ABORT_ERR"));
      if (isAbort) {
        throw new PayoutProviderError({
          message: `Flip request timed out after ${FlipPayoutProvider.REQUEST_TIMEOUT_MS}ms`,
          kind: "timeout",
          httpStatus: null,
          rawResponse: null,
        });
      }
      throw new PayoutProviderError({
        message: `Flip network error: ${err instanceof Error ? err.message : String(err)}`,
        kind: "server_error",
        httpStatus: null,
        rawResponse: null,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private extractErrorMessage(parsed: unknown): string {
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const msg = obj.message ?? obj.name ?? obj.code;
      if (typeof msg === "string") return msg;
      if (Array.isArray(obj.errors) && obj.errors.length > 0) {
        const first = obj.errors[0] as Record<string, unknown>;
        if (typeof first.message === "string") return first.message;
      }
    }
    return typeof parsed === "string" ? parsed : "unknown error";
  }

  private requireConfig(): FlipCredentials {
    const secretKey = this.config.getOrThrow<string>("FLIP_SECRET_KEY");
    const validationToken = this.config.getOrThrow<string>(
      "FLIP_VALIDATION_TOKEN",
    );
    const apiBase = this.config.getOrThrow<string>("FLIP_API_BASE");
    return { secretKey, validationToken, apiBase };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trim(s: string): string {
  return s.replace(/\/$/, "");
}
