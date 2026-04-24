import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  PAYOUT_PROVIDER_DUITKU,
  PAYOUT_PROVIDER_XENDIT,
  type IPayoutProviderAdapter,
} from "./payout-provider.port";
import {
  PayoutProviderError,
  type TPayoutReceipt,
  type TProviderStatusResult,
} from "./types";

/**
 * Orchestrates the payout side-effect. Consumed by task 24's settle proxy
 * as a fire-and-forget: `payoutService.triggerPayout(intent, merchant)` —
 * the settle response must not block on a successful Xendit round-trip
 * (task 29 §5).
 *
 * Responsibilities:
 *   1. Resolve the right provider from `merchant.payoutProvider`. v1 only
 *      knows `"xendit"`. Unknown values throw a typed error so ops sees it
 *      in the log pipe.
 *   2. Persist a `ProviderPayout` row BEFORE returning — the row is the
 *      audit trail; if the caller crashes afterward the row survives.
 *   3. On provider success → `PENDING`, intent → `SETTLED` stays as-is
 *      (task 30 webhook flips to `PAID_OUT`).
 *   4. On provider failure → `FAILED`, intent stays `SETTLED` for ops to
 *      retry.
 *
 * Spec refs:
 *   - umkm-usdc-payout-spec.md §6.4 (provider call shape)
 *   - umkm-usdc-payout-spec.md §6.6 (`xendit_payouts` columns)
 *   - task file 29 §2 (persistence + intent state machine)
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYOUT_PROVIDER_XENDIT)
    private readonly xenditProvider: IPayoutProviderAdapter,
    @Inject(PAYOUT_PROVIDER_DUITKU)
    private readonly duitkuProvider: IPayoutProviderAdapter,
  ) {}

  /**
   * Fire the payout for a SETTLED intent. Safe to call as fire-and-forget
   * — catches every error internally and logs. Returns the receipt for
   * callers that want to surface status synchronously (none in v1).
   *
   * Filter-at-source: the provider is resolved from the merchant row's
   * `payoutProvider` column, never a hardcoded default in the caller
   * (see `feedback_filter_at_source.md`).
   */
  async triggerPayout(
    intent: PaymentIntent,
    merchant: Merchant,
  ): Promise<TPayoutReceipt | null> {
    const provider = this.resolveProvider(merchant.payoutProvider);
    if (!provider) {
      this.logger.error(
        `Unknown payout provider "${merchant.payoutProvider}" for merchantId=${merchant.id} intentId=${intent.id}`,
      );
      await this.persistFailure(intent, merchant, {
        message: `Unknown payout provider "${merchant.payoutProvider}"`,
        rawResponse: null,
      });
      return null;
    }

    try {
      const receipt = await provider.triggerPayout(intent, merchant);
      await this.persistSuccess(intent, merchant, receipt);
      this.logger.log(
        `Xendit payout dispatched intentId=${intent.id} providerPayoutId=${receipt.providerPayoutId ?? "null"} status=${receipt.status}`,
      );
      return receipt;
    } catch (err) {
      const asPayoutErr =
        err instanceof PayoutProviderError
          ? err
          : new PayoutProviderError({
              message: err instanceof Error ? err.message : String(err),
              kind: "unknown",
              httpStatus: null,
              rawResponse: null,
            });
      await this.persistFailure(intent, merchant, {
        message: asPayoutErr.message,
        rawResponse: asPayoutErr.rawResponse,
      });
      this.logger.warn(
        `Xendit payout failed intentId=${intent.id} kind=${asPayoutErr.kind} status=${asPayoutErr.httpStatus ?? "n/a"} message=${asPayoutErr.message}`,
      );
      return null;
    }
  }

  /**
   * Minimal-shape entry point matching task 24's `IPayoutProvider.trigger`
   * contract in `pay/intents.service.ts`. Task 24 calls this with only the
   * intent id from inside its `kickPayout` helper; we load the intent +
   * merchant here and forward to the richer `triggerPayout(...)` above.
   *
   * NOTE: this is the adapter seam — the module binds `PAYOUT_PROVIDER`
   * (task 24's token) to `PayoutService`, so task 24's optional injection
   * resolves cleanly once `PayoutModule` is imported in `AppModule`.
   *
   * Errors are swallowed + logged (matches §5 "Never block the settle
   * response"). Row-level failures are persisted via `persistFailure`.
   */
  async trigger(intentId: string): Promise<void> {
    try {
      const intent = await this.prisma.paymentIntent.findUnique({
        where: { id: intentId },
        include: { merchant: true },
      });
      if (!intent) {
        this.logger.error(
          `PayoutService.trigger: intent ${intentId} not found; skipping Xendit call.`,
        );
        return;
      }
      if (!intent.merchant) {
        this.logger.error(
          `PayoutService.trigger: intent ${intentId} has no merchant attached; skipping.`,
        );
        return;
      }
      await this.triggerPayout(intent, intent.merchant);
    } catch (err) {
      // Defense-in-depth — the fire-and-forget caller already catches, but
      // belt-and-braces ensures we never surface a 500 into the HTTP path.
      this.logger.error(
        `PayoutService.trigger uncaught for intent ${intentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Convenience for the webhook handler (task 30) — proxies to the
   * resolved provider's signature verifier.
   */
  verifyXenditWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: string,
  ): boolean {
    return this.xenditProvider.verifyWebhookSignature(headers, body);
  }

  /**
   * Convenience for ops dashboards / reconciliation.
   */
  async getXenditStatus(
    providerReferenceId: string,
  ): Promise<TProviderStatusResult> {
    return this.xenditProvider.getStatus(providerReferenceId);
  }

  /**
   * Provider factory. This is the **only** place in the codebase that
   * branches on `merchant.payoutProvider` — see the port header rules.
   * Adding a new provider is: (1) new adapter class; (2) new Symbol token
   * in the port; (3) new case arm here + constructor @Inject above.
   */
  private resolveProvider(key: string): IPayoutProviderAdapter | null {
    switch (key) {
      case "xendit":
        return this.xenditProvider;
      case "duitku":
        return this.duitkuProvider;
      default:
        return null;
    }
  }

  private async persistSuccess(
    intent: PaymentIntent,
    merchant: Merchant,
    receipt: TPayoutReceipt,
  ): Promise<void> {
    await this.prisma.providerPayout.create({
      data: {
        intentId: intent.id,
        provider: merchant.payoutProvider,
        providerPayoutId: receipt.providerPayoutId,
        providerResponseCode: receipt.providerResponseCode ?? null,
        referenceId: receipt.referenceId,
        channelCode: receipt.channelCode,
        accountNumberEncrypted: merchant.payoutAccountNumber,
        amount: receipt.amount,
        currency: receipt.currency,
        status: receipt.status,
        requestedAt: receipt.requestedAt,
        providerResponseBody:
          receipt.rawResponse === null ? undefined : (receipt.rawResponse as any),
      },
    });

    // Queue a reconcile job for Duitku rows that landed in PENDING — the
    // transfer response was ambiguous (TO/68/-100) and only `inquiryStatus`
    // can settle the outcome. Xendit rows never reach here in PENDING (its
    // 2xx is terminal-ish and the webhook handles transitions). Keeping the
    // gate provider-agnostic: any provider that hands back a `reconcile`
    // hint gets enqueued, and the handler reads `providerPayoutId` for the
    // reconcile key.
    if (receipt.reconcile && receipt.status === "PENDING") {
      this.logger.log(
        `Payout reconcile hint recorded intentId=${intent.id} provider=${merchant.payoutProvider} providerPayoutId=${receipt.providerPayoutId ?? "null"} reason=${receipt.reconcile.reason}`,
      );
      // The concrete enqueue lives on a queue service in a follow-up task
      // (tests in task 14 assert the hint propagates — the queue binding
      // is ops-facing plumbing, intentionally not wired here).
    }
  }

  private async persistFailure(
    intent: PaymentIntent,
    merchant: Merchant,
    failure: { message: string; rawResponse: unknown; providerResponseCode?: string | null },
  ): Promise<void> {
    await this.prisma.providerPayout.create({
      data: {
        intentId: intent.id,
        provider: merchant.payoutProvider,
        providerPayoutId: null,
        providerResponseCode: failure.providerResponseCode ?? null,
        referenceId: intent.id,
        channelCode: merchant.payoutChannelCode,
        accountNumberEncrypted: merchant.payoutAccountNumber,
        amount: intent.fiatAmountMinor,
        currency: intent.fiatCurrency,
        status: "FAILED",
        requestedAt: new Date(),
        providerResponseBody:
          failure.rawResponse === null
            ? { error: failure.message }
            : ({ error: failure.message, body: failure.rawResponse } as any),
      },
    });
  }
}
