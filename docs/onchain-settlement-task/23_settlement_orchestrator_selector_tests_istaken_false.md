# Task 23 — Selector tests for `SettlementOrchestratorService.resolveProvider`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.2, §9 item 4

## Why this matters

The orchestrator's `resolveProvider` is the single branch point for
settlement rail selection. If it misroutes, intents go to the wrong
adapter. These tests validate the precedence chain and the fail-loud
behavior for unknown keys — same test shape as
`payout.service.resolve-provider.spec.ts` from commit `d9703da`.

## Scope

Create `test/unit/settlement-orchestrator.spec.ts` (or co-located):

**Test cases:**

1. `resolveProvider("nanopay")` → returns `NanopaySettlementProvider`.
2. `resolveProvider("onchain")` → returns `OnchainSettlementProvider`.
3. `resolveProvider("unknown_value")` → throws descriptive error.
4. **Precedence — per-intent path wins:** intent with `path = "direct_arc"`
   resolves to `"onchain"` regardless of `PAYMENT_SETTLEMENT_RAIL` env.
5. **Precedence — env default:** intent with unset path falls back to
   `PAYMENT_SETTLEMENT_RAIL` env value.
6. **Precedence — env default fallback:** when env is also unset,
   defaults to `"nanopay"`.
7. **`settleAndKickPayout` calls `kickPayout` only on SETTLED** — mock
   adapter returns `SETTLING` → assert payout NOT triggered.
8. **`settleAndKickPayout` calls `kickPayout` on SETTLED** — mock
   adapter returns `SETTLED` → assert payout triggered.

**Template:** Copy the structure of
`payout.service.resolve-provider.spec.ts` (or
`test/unit/payout-resolve-provider.spec.ts`).

## Rules (non-negotiable)

- **Every precedence level tested.** Per-intent, env, default.
- **Unknown key fails loud** with a descriptive error message.
- **`kickPayout` tested for both outcomes** (called vs. not called).

## Acceptance

- [ ] All 8 test cases pass.
- [ ] `pnpm run test -- --testPathPattern=settlement-orchestrator` passes.

## Out of scope

- Adapter-level tests (tasks 22, 25).
- Per-merchant preference (not in v1).
