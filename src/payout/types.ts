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
 * `ProviderPayoutStatus` Prisma enum today (§6.6), but is deliberately its
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
  /** Provider-side id, e.g. Xendit `disb-…` or Duitku `disburseId`. Null when not yet assigned. */
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
   * Provider-specific response code. Null for providers (like Xendit) that
   * don't use a discrete code to drive retry/reconcile logic. Duitku uses
   * `"00" | "TO" | "68" | "-100" | ...`; the persistence layer writes it
   * verbatim so the reconcile job can scan by indexed column.
   */
  providerResponseCode?: string | null;
  /**
   * Reconcile hint — the adapter has short-circuited because the response
   * code warns "do not retransmit" (Duitku `TO`/`68`/`-100`). PayoutService
   * reads this and enqueues an `inquiryStatus` poll keyed by the provider
   * payout id. Absent for Xendit: its response is terminal-ish and the
   * webhook drives transitions.
   */
  reconcile?: {
    reason: string;
  };
  /**
   * Full raw response body — stored in `ProviderPayout.providerResponseBody`
   * for dispute debugging. `unknown` because provider schemas drift; the
   * persistence layer writes it into Prisma's `Json` column as-is.
   */
  rawResponse: unknown;
}

/**
 * Structured status response from `getStatus(providerReferenceId)`. Richer
 * than a bare `TProviderStatus` enum so the reconcile job can persist the
 * response code + body without re-polling. Xendit's stub returns
 * `{ status: "PENDING" }` — it just ignores the optional fields.
 */
export interface TProviderStatusResult {
  status: TProviderStatus;
  providerResponseCode?: string | null;
  providerResponseBody?: unknown;
  /** `true` when the provider signals "escalate to support" (Duitku `-100`). */
  operationalAlert?: boolean;
}

/**
 * Thrown by adapters on a terminal (non-retryable) provider error — e.g.
 * 4xx with a "duplicate reference id" or "channel not supported" payload.
 * The service layer persists this as a `FAILED` `ProviderPayout` row and
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
