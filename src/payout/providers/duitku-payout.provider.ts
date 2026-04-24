import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { decryptAccountNumber, redactAccountNumber } from "../account-number-crypto";
import {
  buildSignature,
  buildTimestamp,
  type DuitkuCredentials,
} from "../duitku-signature";
import type { IPayoutProviderAdapter } from "../payout-provider.port";
import { getProviderChannel } from "../provider-channel";
import {
  PayoutProviderError,
  type TPayoutReceipt,
  type TProviderStatusResult,
} from "../types";

/**
 * Duitku disbursement adapter (Online Transfer / RTOL + e-wallet).
 *
 * Spec refs:
 *   - duitku_payout_provider_research.md §2 (API summary), §3 (delta vs
 *     Xendit), §4.3 (adapter contract), §4.4 (retry discipline), §4.5
 *     (signature), §4.6 (webhook controller — v1: none)
 *   - task files 06, 07, 08, 09
 *
 * Flow (triggerPayout):
 *   1. `/inquiry` — validates balance, returns bank-reported `accountName`
 *      + Duitku `disburseId`. Mismatch vs `merchant.payoutAccountHolderName`
 *      aborts the transfer.
 *   2. `/transfer` — `custRefNumber = intent.id` (idempotency key, same as
 *      Xendit). Response is terminal for RTOL/e-wallet.
 *
 * Retry discipline (research §2.6):
 *   - Transport-layer retry (5xx / timeout / network) — 3 attempts,
 *     exponential backoff matching Xendit (100ms × 4^attempt).
 *   - Response-code filter layered on top: if the transfer 2xx returns
 *     `responseCode ∈ { "TO", "68", "-100" }` we MUST NOT retransmit.
 *     Retransmitting can double-disburse. Instead return a PENDING receipt
 *     carrying a `reconcile` hint — `PayoutService` enqueues an
 *     `inquirystatus` poll (task 08 + queue plumbing).
 *
 * Port rules honored:
 *   - No `process.env` reads — all creds via `ConfigService.getOrThrow`.
 *   - Secret + plaintext account + signature never logged.
 *   - Return value shape matches the Xendit adapter byte-for-byte (same
 *     keys on `TPayoutReceipt`).
 */
@Injectable()
export class DuitkuPayoutProvider implements IPayoutProviderAdapter {
  private readonly logger = new Logger(DuitkuPayoutProvider.name);
  private static readonly REQUEST_TIMEOUT_MS = 60_000;
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly RETRY_BASE_MS = 100;
  private static readonly RETRY_FACTOR = 4;

  /**
   * Response codes that Duitku docs explicitly warn **never** to
   * retransmit. Retransmitting any of these on `/transfer` can cause a
   * double-disbursement because the original request may already be
   * queued for async settlement inside Duitku's rails.
   *
   * Named as a single module-scope `const` so a future reader cannot
   * "tidy up" the retry loop and accidentally drop one of the three. See
   * research §2.6 retry rule; `task 09` §Rules.
   */
  public static readonly AMBIGUOUS_CODES: ReadonlySet<string> = new Set([
    "TO",
    "68",
    "-100",
  ]);

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

    const custRefNumber = intent.id;
    const amount = intent.fiatAmountMinor;
    const purpose = `TakumiPay payout ${intent.id}`;

    this.logger.log(
      `Duitku payout attempt intentId=${intent.id} channel=${merchant.payoutChannelCode} bankCode=${bankCode} amount=${amount} ${intent.fiatCurrency} account=${redacted}`,
    );

    // 1. Inquiry step — validates balance + returns real holder name.
    const inquiryTimestamp = buildTimestamp();
    const inquiryBody = {
      userId: creds.userId,
      email: creds.email,
      timestamp: inquiryTimestamp,
      bankCode,
      bankAccount: accountNumberPlaintext,
      amountTransfer: amount,
      purpose,
      signature: buildSignature({
        kind: "inquiry",
        email: creds.email,
        timestamp: inquiryTimestamp,
        bankCode,
        bankAccount: accountNumberPlaintext,
        amountTransfer: amount,
        purpose,
        secretKey: creds.secretKey,
      }),
    };

    const inquiry = await this.postWithRetry(
      this.inquiryUrl(creds.apiBase),
      inquiryBody,
      { idempotent: true },
    );

    const inquiryResponseCode = this.extractResponseCode(inquiry.body);
    if (inquiryResponseCode !== "00") {
      throw new PayoutProviderError({
        message: `Duitku inquiry failed: ${inquiryResponseCode ?? "unknown"}`,
        kind: this.kindForResponseCode(inquiryResponseCode),
        httpStatus: inquiry.status,
        rawResponse: inquiry.body,
      });
    }

    const inquiryAccountName = this.extractField(inquiry.body, "accountName");
    if (!this.holderNameMatches(inquiryAccountName, merchant.payoutAccountHolderName)) {
      this.logger.warn(
        `Duitku inquiry holder-name mismatch intentId=${intent.id} expected=${merchant.payoutAccountHolderName} gotHash=${short(inquiryAccountName)}`,
      );
      throw new PayoutProviderError({
        message: "Duitku inquiry: accountName does not match merchant.payoutAccountHolderName",
        kind: "client_error",
        httpStatus: inquiry.status,
        rawResponse: inquiry.body,
      });
    }

    const disburseId = this.extractField(inquiry.body, "disburseId");
    if (!disburseId) {
      throw new PayoutProviderError({
        message: "Duitku inquiry: missing disburseId in 00 response",
        kind: "server_error",
        httpStatus: inquiry.status,
        rawResponse: inquiry.body,
      });
    }

    // 2. Transfer step — use the disburseId + custRefNumber.
    const transferTimestamp = buildTimestamp();
    const transferBody = {
      userId: creds.userId,
      email: creds.email,
      timestamp: transferTimestamp,
      bankCode,
      bankAccount: accountNumberPlaintext,
      accountName: inquiryAccountName,
      custRefNumber,
      amountTransfer: amount,
      purpose,
      disburseId,
      signature: buildSignature({
        kind: "transfer",
        email: creds.email,
        timestamp: transferTimestamp,
        bankCode,
        bankAccount: accountNumberPlaintext,
        accountName: inquiryAccountName ?? "",
        custRefNumber,
        amountTransfer: amount,
        purpose,
        disburseId,
        secretKey: creds.secretKey,
      }),
    };

    // Transfer is NOT idempotent on network retry — response-code filter
    // handles the "never retransmit" cases. HTTP 5xx / timeout still
    // retries because those indicate the request didn't land at all.
    const transfer = await this.postWithRetry(
      this.transferUrl(creds.apiBase),
      transferBody,
      { idempotent: false, ambiguousShortCircuit: true },
    );

    const transferResponseCode = this.extractResponseCode(transfer.body);
    const requestedAt = new Date();
    const baseReceipt: TPayoutReceipt = {
      referenceId: custRefNumber,
      providerPayoutId: disburseId,
      status: "PENDING",
      amount,
      currency: intent.fiatCurrency,
      channelCode: merchant.payoutChannelCode,
      requestedAt,
      providerResponseCode: transferResponseCode,
      rawResponse: transfer.body,
    };

    // --- Ambiguous short-circuit (task 09): never retransmit TO/68/-100.
    if (
      transferResponseCode &&
      DuitkuPayoutProvider.AMBIGUOUS_CODES.has(transferResponseCode)
    ) {
      this.logger.warn(
        `Duitku transfer ambiguous — enqueue reconcile intentId=${intent.id} disburseId=${disburseId} responseCode=${transferResponseCode}`,
      );
      return {
        ...baseReceipt,
        status: "PENDING",
        reconcile: { reason: transferResponseCode },
      };
    }

    // --- Terminal statuses per §2.6.
    switch (transferResponseCode) {
      case "00":
        return { ...baseReceipt, status: "COMPLETED" };
      case "80":
        // H2H-only. Shouldn't occur on RTOL, but map if it does.
        return { ...baseReceipt, status: "PROCESSING" };
      case "01":
      case "-510":
      case "-141":
      case "-148":
      case "-149":
      case "-192":
      case "-420":
      case "76":
        if (transferResponseCode === "-510") {
          this.logger.error(
            `Duitku transfer -510 Insufficient merchant funds intentId=${intent.id} disburseId=${disburseId} — master balance empty.`,
          );
        }
        return { ...baseReceipt, status: "FAILED" };
      case "-191":
      case "-213":
      case "-930":
      case "-960":
        // Adapter / config bugs — surface as client_error so PayoutService
        // persists FAILED and ops sees a clear kind on the log.
        throw new PayoutProviderError({
          message: `Duitku transfer adapter-config error: ${transferResponseCode}`,
          kind: "client_error",
          httpStatus: transfer.status,
          rawResponse: transfer.body,
        });
      case "-951":
      case "-952":
      case "-920":
        throw new PayoutProviderError({
          message: `Duitku transfer upstream error: ${transferResponseCode}`,
          kind: "server_error",
          httpStatus: transfer.status,
          rawResponse: transfer.body,
        });
      default:
        // Unknown code — treat as PENDING with a reconcile hint so ops
        // investigates rather than us pretending to know.
        this.logger.warn(
          `Duitku transfer unknown responseCode=${transferResponseCode ?? "null"} intentId=${intent.id} disburseId=${disburseId} — treating as PENDING+reconcile.`,
        );
        return {
          ...baseReceipt,
          status: "PENDING",
          reconcile: { reason: transferResponseCode ?? "unknown" },
        };
    }
  }

  async getStatus(providerReferenceId: string): Promise<TProviderStatusResult> {
    const creds = this.requireConfig();
    const timestamp = buildTimestamp();
    const body = {
      userId: creds.userId,
      email: creds.email,
      timestamp,
      disburseId: providerReferenceId,
      signature: buildSignature({
        kind: "inquiryStatus",
        email: creds.email,
        timestamp,
        disburseId: providerReferenceId,
        secretKey: creds.secretKey,
      }),
    };
    const res = await this.postWithRetry(
      `${trim(creds.apiBase)}/inquirystatus`,
      body,
      { idempotent: true },
    );
    const responseCode = this.extractResponseCode(res.body);

    switch (responseCode) {
      case "00":
        return {
          status: "COMPLETED",
          providerResponseCode: responseCode,
          providerResponseBody: res.body,
        };
      case "80":
        return {
          status: "PROCESSING",
          providerResponseCode: responseCode,
          providerResponseBody: res.body,
        };
      case "68":
      case "TO":
        return {
          status: "PENDING",
          providerResponseCode: responseCode,
          providerResponseBody: res.body,
        };
      case "-100":
        this.logger.warn(
          `Duitku inquiryStatus -100 (operationalAlert) disburseId=${providerReferenceId} — escalate to support.`,
        );
        return {
          status: "PENDING",
          providerResponseCode: responseCode,
          providerResponseBody: res.body,
          operationalAlert: true,
        };
      case "01":
      case "-510":
      case "-141":
      case "-148":
      case "-149":
      case "-192":
      case "-420":
      case "76":
        return {
          status: "FAILED",
          providerResponseCode: responseCode,
          providerResponseBody: res.body,
        };
      case "-191":
      case "-213":
      case "-930":
      case "-960":
        throw new PayoutProviderError({
          message: `Duitku inquiryStatus adapter-config error: ${responseCode}`,
          kind: "client_error",
          httpStatus: res.status,
          rawResponse: res.body,
        });
      case "-951":
      case "-952":
      case "-920":
        throw new PayoutProviderError({
          message: `Duitku inquiryStatus upstream error: ${responseCode}`,
          kind: "server_error",
          httpStatus: res.status,
          rawResponse: res.body,
        });
      default:
        this.logger.warn(
          `Duitku inquiryStatus unknown responseCode=${responseCode ?? "null"} disburseId=${providerReferenceId} — holding at PENDING.`,
        );
        return {
          status: "PENDING",
          providerResponseCode: responseCode ?? null,
          providerResponseBody: res.body,
        };
    }
  }

  verifyWebhookSignature(
    _headers: Record<string, string | string[] | undefined>,
    _body: string,
  ): boolean {
    // v1 RTOL / e-wallet has no callback — research §2.8. When H2H /
    // Cash-Out lands we'll wire `verifyCallbackSignature` from
    // `duitku-signature.ts` here.
    return false;
  }

  /**
   * Read master merchant balance from Duitku (task 18, research §2.3).
   *
   * Deliberately NOT on `IPayoutProviderAdapter` — this is a Duitku-
   * specific ops feature; adding it to the port would force every
   * provider to implement it. Callers should type against the concrete
   * `DuitkuPayoutProvider` class (e.g. an admin controller).
   *
   * Duitku's `-510 Insufficient merchant funds` surfaces on `transfer`;
   * by then an intent has already failed. This lets the dashboard /
   * alerting poll ahead of that failure.
   */
  async checkBalance(): Promise<{ balance: number; currency: "IDR" }> {
    const creds = this.requireConfig();
    const timestamp = buildTimestamp();
    const body = {
      userId: creds.userId,
      email: creds.email,
      timestamp,
      signature: buildSignature({
        kind: "checkBalance",
        email: creds.email,
        timestamp,
        secretKey: creds.secretKey,
      }),
    };
    const res = await this.postWithRetry(
      `${trim(creds.apiBase)}/checkbalance`,
      body,
      { idempotent: true },
    );
    const responseCode = this.extractResponseCode(res.body);
    if (responseCode !== "00") {
      const kind = this.kindForResponseCode(responseCode);
      throw new PayoutProviderError({
        message: `Duitku checkBalance failed: ${responseCode ?? "unknown"}`,
        kind,
        httpStatus: res.status,
        rawResponse: res.body,
      });
    }
    const balanceRaw =
      res.body && typeof res.body === "object"
        ? (res.body as Record<string, unknown>).balance
        : null;
    const balance =
      typeof balanceRaw === "number"
        ? balanceRaw
        : typeof balanceRaw === "string"
          ? Number(balanceRaw)
          : NaN;
    if (!Number.isFinite(balance)) {
      throw new PayoutProviderError({
        message: "Duitku checkBalance: missing/invalid balance in 00 response",
        kind: "server_error",
        httpStatus: res.status,
        rawResponse: res.body,
      });
    }
    this.logger.log(`Duitku master balance=${balance} currency=IDR`);
    return { balance, currency: "IDR" };
  }

  /**
   * Resolve the Duitku wire-code for the merchant's canonical channel via
   * `ProviderChannel(provider = 'duitku')`. Throws a client_error if no
   * mapping exists — means ops forgot to seed the row.
   */
  private async resolveBankCode(merchant: Merchant): Promise<string> {
    if (!this.prisma) {
      throw new PayoutProviderError({
        message: "PrismaService not injected into DuitkuPayoutProvider",
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
        message: `Missing ProviderChannel row for (${merchant.payoutChannelCode}, ${merchant.country}, duitku). Seed the row before enabling Duitku for this merchant.`,
        kind: "client_error",
        httpStatus: null,
        rawResponse: null,
      });
    }
    return pc.providerChannelCode;
  }

  /**
   * Fire a POST with adapter-owned transport retry. Caller signals
   * `idempotent` (for inquiry / inquirystatus — safe to retry on network
   * errors) vs the transfer call. For transfer we still retry on pure
   * transport failure (the request didn't land), but the response-code
   * ambiguity short-circuit lives in `triggerPayout` above — the filter
   * applies when we DO get a 2xx with an ambiguous body.
   */
  private async postWithRetry(
    url: string,
    body: unknown,
    opts: { idempotent: boolean; ambiguousShortCircuit?: boolean },
  ): Promise<{ status: number; body: unknown }> {
    let lastErr: PayoutProviderError | null = null;
    for (let attempt = 1; attempt <= DuitkuPayoutProvider.MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.postOnce(url, body);
        // Body-level ambiguous codes on the transfer endpoint break out of
        // the retry loop immediately — see research §2.6 retry rule. The
        // short-circuit is only meaningful for non-idempotent calls.
        if (
          opts.ambiguousShortCircuit &&
          DuitkuPayoutProvider.AMBIGUOUS_CODES.has(
            this.extractResponseCode(res.body) ?? "",
          )
        ) {
          return res;
        }
        return res;
      } catch (err) {
        if (!(err instanceof PayoutProviderError)) throw err;
        lastErr = err;
        if (err.kind === "client_error") throw err;
        if (!opts.idempotent && attempt > 1) {
          // Non-idempotent: we do not retry after the first attempt landed
          // but failed — second attempt risks double-disbursement.
          throw err;
        }
        if (attempt >= DuitkuPayoutProvider.MAX_ATTEMPTS) break;
        const delayMs =
          DuitkuPayoutProvider.RETRY_BASE_MS *
          DuitkuPayoutProvider.RETRY_FACTOR ** (attempt - 1);
        this.logger.warn(
          `Duitku ${opts.idempotent ? "(idempotent)" : "(non-idempotent)"} transient failure attempt=${attempt}/${DuitkuPayoutProvider.MAX_ATTEMPTS} kind=${err.kind} retryInMs=${delayMs}`,
        );
        await sleep(delayMs);
      }
    }
    throw (
      lastErr ??
      new PayoutProviderError({
        message: "Duitku: exhausted retries with no captured error",
        kind: "unknown",
        httpStatus: null,
        rawResponse: null,
      })
    );
  }

  private async postOnce(
    url: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DuitkuPayoutProvider.REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await this.httpFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
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
          message: `Duitku HTTP ${response.status}`,
          kind: "client_error",
          httpStatus: response.status,
          rawResponse: parsed,
        });
      }
      throw new PayoutProviderError({
        message: `Duitku HTTP ${response.status}`,
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
          message: `Duitku request timed out after ${DuitkuPayoutProvider.REQUEST_TIMEOUT_MS}ms`,
          kind: "timeout",
          httpStatus: null,
          rawResponse: null,
        });
      }
      throw new PayoutProviderError({
        message: `Duitku network error: ${err instanceof Error ? err.message : String(err)}`,
        kind: "server_error",
        httpStatus: null,
        rawResponse: null,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Pick the right endpoint based on whether the configured apiBase is
   * the sandbox host. Duitku's sandbox endpoints append `sandbox` to the
   * path (`/inquirysandbox`, `/transfersandbox`) — prod drops it.
   */
  private inquiryUrl(apiBase: string): string {
    return `${trim(apiBase)}/${this.isSandbox(apiBase) ? "inquirysandbox" : "inquiry"}`;
  }
  private transferUrl(apiBase: string): string {
    return `${trim(apiBase)}/${this.isSandbox(apiBase) ? "transfersandbox" : "transfer"}`;
  }
  private isSandbox(apiBase: string): boolean {
    return /sandbox\.duitku\.com/i.test(apiBase);
  }

  private extractResponseCode(body: unknown): string | null {
    if (body && typeof body === "object") {
      const v = (body as Record<string, unknown>).responseCode;
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
    }
    return null;
  }

  private extractField(body: unknown, field: string): string | null {
    if (body && typeof body === "object") {
      const v = (body as Record<string, unknown>)[field];
      return typeof v === "string" ? v : null;
    }
    return null;
  }

  /**
   * Case-sensitive + trimmed compare. Duitku's `accountName` is what the
   * bank / e-wallet actually has on file; we stored the name the merchant
   * self-declared. If a fuzzier policy is ever needed, centralize it here
   * — do NOT add ad-hoc `.replace()` chains at the call site.
   */
  private holderNameMatches(
    bankReported: string | null,
    merchantStored: string,
  ): boolean {
    if (!bankReported) return false;
    return bankReported.trim() === merchantStored.trim();
  }

  private kindForResponseCode(code: string | null): "client_error" | "server_error" | "unknown" {
    if (!code) return "unknown";
    if (["-951", "-952", "-920"].includes(code)) return "server_error";
    return "client_error";
  }

  private requireConfig(): DuitkuCredentials {
    const userIdRaw = this.config.getOrThrow<string>("DUITKU_DISB_USER_ID");
    const userIdNum = Number(userIdRaw);
    if (!Number.isFinite(userIdNum) || userIdNum <= 0) {
      throw new PayoutProviderError({
        message: "DUITKU_DISB_USER_ID must be a positive integer",
        kind: "unknown",
        httpStatus: null,
        rawResponse: null,
      });
    }
    const email = this.config.getOrThrow<string>("DUITKU_DISB_EMAIL");
    const secretKey = this.config.getOrThrow<string>("DUITKU_DISB_SECRET_KEY");
    const apiBase = this.config.getOrThrow<string>("DUITKU_DISB_API_BASE");
    return { userId: userIdNum, email, secretKey, apiBase };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trim(s: string): string {
  return s.replace(/\/$/, "");
}

/**
 * Redacted short hash used only to distinguish distinct name-mismatch
 * events in logs — we never log the full bank-reported name (could
 * incidentally leak customer data). First 4 chars of a non-crypto hash
 * is enough to spot patterns without the raw material.
 */
function short(s: string | null): string {
  if (!s) return "null";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).padStart(4, "0").slice(0, 8);
}
