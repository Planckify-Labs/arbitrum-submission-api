# Task 25 — Verify existing nanopay + payout test suites pass unchanged

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §9 item 5

## Why this matters

The settlement port refactor (Phase 2) rewires how nanopay settlement
is invoked. If any existing nanopay or payout test breaks, the refactor
introduced a regression. This task is the explicit gate that confirms
zero breakage before Phase 4 work begins.

## Scope

- Run the full existing test suite:
  ```bash
  pnpm run test
  pnpm run test:e2e
  ```
- Specifically verify:
  - All nanopay-related tests pass (search for `nanopay` in test files).
  - `test/duitku-sandbox.e2e-spec.ts` passes.
  - `test/provider-agnostic-payout-migration.e2e-spec.ts` passes (if
    it exists).
  - Any tests in `test/` referencing `IntentsService.submitNanopay`
    pass.
- If any test fails, investigate whether the failure is caused by
  Phase 2 changes (tasks 09–12) or a pre-existing issue. Fix
  regressions introduced by Phase 2; file separate issues for
  pre-existing failures.

## Rules (non-negotiable)

- **Zero regressions from Phase 2.** Every test that passed before
  tasks 09–12 must still pass.
- **Do not skip or `xit` failing tests.** Fix them.
- **Document any pre-existing failures** that are unrelated to this
  work (if found).

## Acceptance

- [ ] `pnpm run test` — all pass.
- [ ] `pnpm run test:e2e` — all pass.
- [ ] No tests were skipped, deleted, or modified to make them pass
      (unless fixing a genuine Phase 2 regression).

## Out of scope

- New onchain-specific tests (tasks 22, 23, 24).
- Performance testing.
