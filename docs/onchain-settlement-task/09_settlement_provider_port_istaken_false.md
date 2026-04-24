# Task 09 — Define `IPaymentSettlementProvider` port + types + Symbol tokens

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.1

## Why this matters

This is the space-docking port for settlement rails — the same pattern
as `IPayoutProviderAdapter` (commit `d9703da`). Every settlement adapter
implements this interface; callers never branch on rail. Without the
port, the onchain adapter (task 18) can't be added without touching
every caller.

## Scope

Create `src/pay/settlement/settlement-provider.port.ts`:

```ts
export interface IPaymentSettlementProvider {
  readonly key: "nanopay" | "onchain";
  settle(args: SettleArgs): Promise<SettleReceipt>;
}

export const PAYMENT_SETTLEMENT_NANOPAY = Symbol("PAYMENT_SETTLEMENT_NANOPAY");
export const PAYMENT_SETTLEMENT_ONCHAIN = Symbol("PAYMENT_SETTLEMENT_ONCHAIN");
```

Create `src/pay/settlement/settlement.types.ts`:

- `SettleArgs` — `{ intent: PaymentIntent & relations, merchant: Merchant, payerInput: PayerInput }`.
- `PayerInput` — discriminated union:
  - `{ kind: "signature"; signature: string }` (nanopay)
  - `{ kind: "txHash"; txHash: string; chainId: number }` (onchain)
- `SettleReceipt` — `{ settlementId: string; status: "SETTLED" | "SETTLING"; txHash?: string }`.
- `SettlementRejectedError` — terminal failure (maps to `intent.FAILED`).
- `SettlementInFlightError` — timeout / pending (maps to `SETTLING` on wire).

## Rules (non-negotiable)

- **Mirror the payout port pattern exactly.** Same file structure, same
  Symbol-token convention, same JSDoc style. Reference
  `src/payout/payout-provider.port.ts` for the template.
- **No Nest DI in the port file.** Pure interface + types. DI wiring
  lives in the module (task 12).
- **`PayerInput` is a discriminated union**, not a bag of optionals.
  Adapters assert `payerInput.kind` and get type narrowing.

## Acceptance

- [ ] `src/pay/settlement/settlement-provider.port.ts` exports
      `IPaymentSettlementProvider`, `PAYMENT_SETTLEMENT_NANOPAY`,
      `PAYMENT_SETTLEMENT_ONCHAIN`.
- [ ] `src/pay/settlement/settlement.types.ts` exports `SettleArgs`,
      `PayerInput`, `SettleReceipt`, `SettlementRejectedError`,
      `SettlementInFlightError`.
- [ ] `pnpm run build` passes.
- [ ] No runtime code — types and interfaces only (plus error classes).

## Out of scope

- Nanopay adapter implementation (task 10).
- Onchain adapter implementation (task 18).
- Orchestrator service (task 11).
