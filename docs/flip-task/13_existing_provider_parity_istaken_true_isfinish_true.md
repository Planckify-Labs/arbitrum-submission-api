# Task 13 — Re-run existing Xendit + Duitku specs unchanged post-wiring

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §4.9 (DI wiring must not break existing adapters)

## Why this matters

Adding a third adapter to the DI container changes the module
registration and constructor injection of `PayoutService`. If any
existing test relied on the provider array length, injection order, or
default behavior, it would break silently. This task is a confidence
gate: run every existing Xendit and Duitku spec unchanged and verify
they still pass. Mirrors task 17 from the Duitku backlog.

**Depends on:** task 03 (DI wiring complete — `FlipPayoutProvider`
registered in `PayoutModule`).

## Scope

Run the full existing test suite with no modifications:

```bash
pnpm run test -- --testPathPattern=xendit-payout.provider
pnpm run test -- --testPathPattern=duitku-payout.provider
pnpm run test -- --testPathPattern=payout.service
pnpm run test -- --testPathPattern=webhook.controller
pnpm run test -- --testPathPattern=resolve-provider
```

If any test fails:

1. **Diagnose** whether the failure is caused by the Flip wiring
   (e.g., missing mock for the new injection token) or a pre-existing
   flake.
2. **Fix the test setup** to accommodate the new provider token —
   typically adding a mock `PAYOUT_PROVIDER_FLIP` to
   `Test.createTestingModule` overrides.
3. **Do NOT change test assertions.** The existing adapter behavior
   must be identical. If a test assertion fails, something in the
   wiring is wrong, not the test.

## Rules (non-negotiable)

- **Do not modify existing test assertions.** Only test setup (module
  overrides, mock providers) may change.
- **Every Xendit spec must pass.** The Xendit adapter is the
  production workhorse — regressions here are critical.
- **Every Duitku spec must pass.** Duitku was just wired; breaking it
  while adding Flip would be embarrassing.
- **If a test needs a `PAYOUT_PROVIDER_FLIP` mock, add it as a
  no-op.** The existing tests shouldn't exercise Flip code paths.

## Acceptance

- [ ] `pnpm run test -- --testPathPattern=xendit-payout.provider` — all green.
- [ ] `pnpm run test -- --testPathPattern=duitku-payout.provider` — all green.
- [ ] `pnpm run test -- --testPathPattern=payout.service` — all green.
- [ ] `pnpm run test -- --testPathPattern=webhook.controller` — all green.
- [ ] `pnpm run test -- --testPathPattern=resolve-provider` — all green.
- [ ] No existing test assertions were modified.
- [ ] `pnpm run test` (full suite) green.

## Out of scope

- New Flip-specific tests — tasks 09, 10, 11.
- Sandbox e2e — task 12.
