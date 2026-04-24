import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { SettleArgs, SettleReceipt } from "./settlement.types";

/**
 * The space-docking port for the payment settlement rail.
 *
 * v1 ships two adapters: `NanopaySettlementProvider` (Circle x402 via
 * existing `IntentsService.submitNanopay`) and an `OnchainSettlementProvider`
 * stub (task 18). When additional rails land they slot in as new adapter
 * files implementing this interface -- the orchestrator caller stays
 * untouched. Mirrors the `IPayoutProviderAdapter` pattern in `payout/`.
 *
 * Spec refs:
 *   - onchain-settlement-spec.md Phase 2 "Settlement Port + Nanopay Adapter"
 *
 * Rules (non-negotiable):
 * - NO `if (rail === "nanopay")` branches leak into callers. The
 *   factory (`SettlementOrchestratorService.resolveProvider`) is the only
 *   spot that inspects the rail key.
 * - Adapters read their own env via Nest's `ConfigService` -- never
 *   through `process.env` directly, so tests can inject a stub without
 *   wrestling with module-scope globals.
 */
export interface IPaymentSettlementProvider {
  readonly key: "nanopay" | "onchain";
  settle(args: SettleArgs): Promise<SettleReceipt>;
}

/**
 * Injection token for the Nanopay (Circle x402) settlement adapter.
 * Bound to `NanopaySettlementProvider` in `SettlementModule`.
 */
export const PAYMENT_SETTLEMENT_NANOPAY = Symbol("PAYMENT_SETTLEMENT_NANOPAY");

/**
 * Injection token for the onchain (direct contract) settlement adapter.
 * Stub in Phase 2; replaced by real `OnchainSettlementProvider` in task 18.
 */
export const PAYMENT_SETTLEMENT_ONCHAIN = Symbol("PAYMENT_SETTLEMENT_ONCHAIN");
