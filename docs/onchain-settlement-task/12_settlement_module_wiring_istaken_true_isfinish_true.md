# Task 12 — `SettlementModule` DI registration + integrate with `IntentsService`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.1, §4.2, §2.4

## Why this matters

The module is the NestJS glue that binds Symbol tokens to adapter
instances and registers the orchestrator. Without it, DI can't resolve
`PAYMENT_SETTLEMENT_NANOPAY` / `PAYMENT_SETTLEMENT_ONCHAIN` and the
orchestrator can't be injected.

## Scope

Create `src/pay/settlement/settlement.module.ts`:

- Register `NanopaySettlementProvider` bound to `PAYMENT_SETTLEMENT_NANOPAY`.
- Register a **stub** `OnchainSettlementProvider` bound to
  `PAYMENT_SETTLEMENT_ONCHAIN` (throws `NotImplementedError` on
  `settle()`). Task 18 replaces the stub with the real implementation.
- Export `SettlementOrchestratorService`.
- Import required modules (`PrismaModule`, `ConfigModule`,
  `BlockchainVerificationModule`, etc.).

**Integration with `IntentsService`:**

- Wire `IntentsService` (or the relevant controller) to call
  `SettlementOrchestratorService.settleAndKickPayout` instead of
  calling `submitNanopay` directly for the nanopay endpoint.
- Verify that the existing `POST /v1/pay/intents/:id/nanopay` endpoint
  still works identically through the new orchestrator path.

## Rules (non-negotiable)

- **Mirror `PayoutModule`** wiring pattern (`payout.module.ts:36-57`).
  Same Symbol-token bind, same constructor `@Inject` pattern.
- **Existing nanopay behavior unchanged.** The refactor is transparent —
  same request in, same response out.
- **Stub onchain adapter** — this task does NOT implement onchain
  settlement. It only reserves the DI slot.

## Acceptance

- [ ] `SettlementModule` registers both Symbol tokens.
- [ ] `SettlementOrchestratorService` is injectable in `IntentsService`
      / controller.
- [ ] `POST /v1/pay/intents/:id/nanopay` works through the orchestrator.
- [ ] All existing nanopay + payout tests pass unchanged.
- [ ] `pnpm run build` passes.

## Out of scope

- Real onchain adapter (task 18).
- New endpoint `POST /v1/pay/intents/:id/onchain` (task 19).
