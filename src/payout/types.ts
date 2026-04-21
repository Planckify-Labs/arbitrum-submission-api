/**
 * Shared payout types — consumed by the `PayoutProvider` port (see
 * `payout-provider.port.ts`) and every concrete adapter.
 *
 * Spec refs:
 *   - umkm-usdc-payout-spec.md §6.4 (Xendit payout, server-internal)
 *   - umkm-usdc-payout-spec.md §6.6 (database shape — `xendit_payouts`)
 *   - task file 29 (PayoutProvider space-docking pattern)
 *
 * Keep this module dependency-free (no Nest, no Prisma, no viem) — it's
 * intentionally trivial so a future adapter package can import only this
 * file without dragging the settlement core along.
 */

/**
 * Coarse status the port surfaces to `PayoutService`. Maps 1:1 onto the
 * `XenditPayoutStatus` Prisma enum today (§6.6), but is deliberately its
 * own type so other adapters (Flip / Paymongo / etc.) aren't forced to
 * speak Xendit's vocabulary.
 */
export type TProviderStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

/**
 * Result of a successful `triggerPayout(...)` round-trip with the provider.
 * On failure the adapter should throw — callers persist the failure via
 * the catch branch in `PayoutService`.
 *
 * `providerPayoutId` is optional because some providers return a 2xx
 * accept-and-enqueue response with only the reference id; the real id
 * lands on the webhook.
 */
export interface TPayoutReceipt {
  /** Our correlation id — always equals `intent.id` so retries dedupe. */
  referenceId: string;
  /** Provider-side id, e.g. Xendit `disb-…`. Null when not yet assigned. */
  providerPayoutId: string | null;
  /** Coarse provider-reported status at the moment of the response. */
  status: TProviderStatus;
  /** Fiat amount dispatched — echoed back for the persistence layer. */
  amount: number;
  /** Fiat currency (e.g. `"IDR"`). */
  currency: string;
  /** Merchant's disbursement channel (e.g. `"GOPAY"`, `"BCA"`). */
  channelCode: string;
  /** Wall-clock at which the adapter received the 2xx. */
  requestedAt: Date;
  /**
   * Full raw response body — stored in `xendit_payouts.xenditResponseBody`
   * for dispute debugging. `unknown` because provider schemas drift; the
   * persistence layer writes it into Prisma's `Json` column as-is.
   */
  rawResponse: unknown;
}

/**
 * Thrown by adapters on a terminal (non-retryable) provider error — e.g.
 * 4xx with a "duplicate reference id" or "channel not supported" payload.
 * The service layer persists this as a `FAILED` `XenditPayout` row and
 * leaves the intent in `SETTLED` for manual ops retry.
 */
export class PayoutProviderError extends Error {
  readonly kind: "client_error" | "server_error" | "timeout" | "unknown";
  readonly httpStatus: number | null;
  readonly rawResponse: unknown;

  constructor(args: {
    message: string;
    kind: "client_error" | "server_error" | "timeout" | "unknown";
    httpStatus: number | null;
    rawResponse: unknown;
  }) {
    super(args.message);
    this.name = "PayoutProviderError";
    this.kind = args.kind;
    this.httpStatus = args.httpStatus;
    this.rawResponse = args.rawResponse;
  }
}
