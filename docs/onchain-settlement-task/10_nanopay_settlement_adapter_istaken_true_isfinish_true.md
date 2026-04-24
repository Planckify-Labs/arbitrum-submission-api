# Task 10 — Wrap existing `IntentsService.submitNanopay` into `NanopaySettlementProvider`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.1 (nanopay adapter row), §10 Phase 2

## Why this matters

Before adding the onchain adapter, the existing nanopay settlement logic
must be wrapped behind the `IPaymentSettlementProvider` interface. This
is the behavior-preserving refactor step — every existing test must
continue to pass. Once this ships, the orchestrator (task 11) can route
to nanopay via the port instead of calling `IntentsService.submitNanopay`
directly.

## Scope

Create `src/pay/settlement/providers/nanopay.settlement.provider.ts`:

```ts
@Injectable()
export class NanopaySettlementProvider implements IPaymentSettlementProvider {
  readonly key = "nanopay";

  async settle(args: SettleArgs): Promise<SettleReceipt> {
    if (args.payerInput.kind !== "signature") {
      throw new SettlementRejectedError("PAYER_INPUT_WRONG_KIND", ...);
    }
    // Delegate to the existing submitNanopay logic.
    // Either call IntentsService.submitNanopay directly,
    // or extract the core logic into a shared helper.
  }
}
```

- The adapter wraps the existing `IntentsService.submitNanopay` EVM
  logic (`intents.service.ts:750-886`). It should delegate to the
  existing implementation — do NOT rewrite the nanopay logic.
- Map the existing `NanopaySubmission` result to `SettleReceipt`.
- Map existing error paths to `SettlementRejectedError` or
  `SettlementInFlightError`.

## Rules (non-negotiable)

- **Behavior-preserving.** Every existing nanopay test must pass without
  modification.
- **Do not move or restructure `IntentsService.submitNanopay` yet.** The
  adapter calls into it. A deeper extraction can happen in a follow-up.
- **SVM nanopay** (`intents.service.ts:912-1046`) is handled by a
  separate adapter if needed — this task covers EVM nanopay only, which
  is the current production path.

## Acceptance

- [ ] `NanopaySettlementProvider` implements `IPaymentSettlementProvider`.
- [ ] `settle()` produces the same outcome as calling `submitNanopay`
      directly (same DB writes, same response shape).
- [ ] All existing nanopay tests pass unchanged.
- [ ] `pnpm run build` passes.

## Out of scope

- Onchain adapter (task 18).
- Orchestrator wiring (task 11).
- SVM nanopay adapter (separate future task if needed).
