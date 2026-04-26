# Task 11 — Integration — `resolveProvider` switches to Flip per `merchant.payoutProvider`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §4.9

## Why this matters

This integration test verifies that the full DI chain works end to
end: `PayoutService` receives a merchant with
`payoutProvider = "flip"`, resolves to `FlipPayoutProvider`, and the
adapter is correctly wired with its dependencies. Without this test,
a broken module binding could silently route Flip merchants to the
wrong adapter or throw a DI error at runtime.

**Depends on:** task 03 (DI wiring in place).

## Scope

Add Flip test case to
`src/payout/payout.service.resolve-provider.spec.ts` (or equivalent
integration test file):

1. **Bootstrap `PayoutModule`** via `Test.createTestingModule` with
   all three adapters registered.

2. **Test: `resolveProvider("flip")` returns `FlipPayoutProvider`.**
   Assert the returned adapter is an instance of `FlipPayoutProvider`.

3. **Test: all three providers coexist.**
   - `resolveProvider("xendit")` → `XenditPayoutProvider`
   - `resolveProvider("duitku")` → `DuitkuPayoutProvider`
   - `resolveProvider("flip")` → `FlipPayoutProvider`

4. **Test: unknown provider still returns `null`** (or throws, matching
   current behavior). Verify existing behavior is unchanged.

5. **Test: `FlipPayoutProvider` resolves its dependencies.**
   The adapter should instantiate without DI errors — `ConfigService`
   and any transport/fetch dependencies are available.

## Rules (non-negotiable)

- **Do not break existing Xendit/Duitku test cases.** Adding Flip must
  not change the behavior of other provider resolution paths.
- **Use `Test.createTestingModule`, not manual instantiation.** The
  point is to test the DI wiring, not the class constructor.
- **Mock external services (ConfigService values, fetch), not the DI
  container.** The test should verify real NestJS DI resolution.

## Acceptance

- [ ] `resolveProvider("flip")` returns an instance of
      `FlipPayoutProvider`.
- [ ] `resolveProvider("xendit")` and `resolveProvider("duitku")`
      still return correct adapters.
- [ ] `resolveProvider("unknown")` behavior unchanged.
- [ ] `FlipPayoutProvider` resolves without DI errors.
- [ ] All existing tests in the file still pass.
- [ ] `pnpm run test -- --testPathPattern=resolve-provider` green.

## Out of scope

- Adapter behavior tests — task 09.
- Full e2e payout flow — task 12.
