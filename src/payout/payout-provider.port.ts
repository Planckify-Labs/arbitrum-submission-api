import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { TPayoutReceipt, TProviderStatusResult } from "./types";

/**
 * The space-docking port for the UMKM fiat payout rail.
 *
 * v1 ships a single adapter (`XenditPayoutProvider`). When Flip / Paymongo /
 * dLocal / BI-licensed acquirer relationships land in M5+, they slot in as
 * new adapter files implementing this interface — the settle-proxy caller
 * stays untouched. Mirrors mobile's `WalletKitAdapter` pattern.
 *
 * Spec refs:
 *   - umkm-usdc-payout-spec.md §6.4 "Pluggable payout provider"
 *   - task file 29 §4 "Provider selection: read merchants.payout_provider"
 *
 * Rules (non-negotiable — see `feedback_chain_extension_discipline.md`):
 * - NO `if (providerName === "xendit")` branches leak into callers. The
 *   factory (`PayoutService.resolveProvider`) is the only spot that looks
 *   at `merchants.payout_provider`.
 * - Adapters NEVER log the provider API key or the account number. Redact
 *   at the log boundary, not at the call site.
 * - Adapters read their own env (`XENDIT_SECRET_KEY`, …) via Nest's
 *   `ConfigService` — never through `process.env` directly, so tests can
 *   inject a stub without wrestling with module-scope globals.
 */
export interface IPayoutProviderAdapter {
  /**
   * Fire a single payout attempt. The adapter owns retry semantics for
   * transient (5xx / timeout) failures; callers treat a thrown
   * `PayoutProviderError` as terminal.
   *
   * @param intent   The settled `PaymentIntent` that triggered this payout.
   * @param merchant The destination merchant row (has channel code +
   *                 encrypted account number on it).
   * @returns        A receipt the service persists as a `ProviderPayout` row.
   */
  triggerPayout(
    intent: PaymentIntent,
    merchant: Merchant,
  ): Promise<TPayoutReceipt>;

  /**
   * Reconcile a previously-requested payout by polling the provider.
   *
   * For Xendit this is effectively a stub — the callback is the source of
   * truth. For Duitku RTOL it is **required**: RTOL has no callback, so
   * ambiguous transfer response codes (`68`/`TO`) are resolved by calling
   * `inquirystatus` here. The richer return shape carries the provider's
   * raw response code + body so the reconcile job can update the
   * `ProviderPayout` row without re-polling.
   */
  getStatus(providerReferenceId: string): Promise<TProviderStatusResult>;

  /**
   * Verify the provider's webhook signature. Xendit uses `x-callback-token`
   * (static shared secret) — other providers may use HMAC over the body.
   * Body is the raw request string (NOT a parsed JSON object) so HMAC
   * schemes can verify against the exact bytes.
   *
   * Returning `false` is the sole rejection signal — callers 401.
   */
  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: string,
  ): boolean;
}

/**
 * Injection token. We could DI the class directly, but future providers
 * may not all be NestJS providers (e.g. an SDK-wrapping service that
 * takes its own constructor args) — binding through a token keeps that
 * door open. Consumed by `PayoutService` via the factory map in
 * `payout.module.ts`.
 */
export const PAYOUT_PROVIDER_XENDIT = Symbol("PAYOUT_PROVIDER_XENDIT");

/**
 * Injection token for the Duitku disbursement adapter (task 06).
 * Bound to `DuitkuPayoutProvider` in `PayoutModule`; consumed by
 * `PayoutService.resolveProvider` when `merchant.payoutProvider === "duitku"`.
 */
export const PAYOUT_PROVIDER_DUITKU = Symbol("PAYOUT_PROVIDER_DUITKU");

/**
 * Injection token for the Flip disbursement adapter.
 * Bound to `FlipPayoutProvider` in `PayoutModule`; consumed by
 * `PayoutService.resolveProvider` when `merchant.payoutProvider === "flip"`.
 */
export const PAYOUT_PROVIDER_FLIP = Symbol("PAYOUT_PROVIDER_FLIP");
