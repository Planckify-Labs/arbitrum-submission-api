# Task 14 — Integration: `resolveProvider` switches per `merchant.payoutProvider`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §1 (port rules), §7 bullet 8

## Why this matters

The entire space-docking design relies on **one** switch — in
`PayoutService.resolveProvider` — to route between adapters. A
regression there (a typo in the case value, a missing DI binding,
forgetting to add the new token) would silently send Duitku-configured
merchants through the Xendit adapter and fail at the first request
with a Xendit-auth error. This test is the catcher for that entire
class of regression.

**Depends on:** tasks 06, 07, 08, 09 (adapter is real enough to
distinguish from Xendit at runtime).

## Scope

Create `src/payout/payout.service.resolve-provider.spec.ts` (or add
to the existing `payout.service.spec.ts`):

- Boot a `Test.createTestingModule` that loads `PayoutModule`, with
  the `HttpService` / transport mocked so no real network is touched.
- Create two merchant fixtures:
  - `merchantXendit.payoutProvider = "xendit"`
  - `merchantDuitku.payoutProvider = "duitku"`
- Call `PayoutService.trigger(intentId)` (or whatever public entry
  point invokes `resolveProvider`) for each.
- For each call, assert which adapter was invoked — either by:
  - Injecting spy wrappers around both `XenditPayoutProvider` and
    `DuitkuPayoutProvider` and asserting which `triggerPayout` ran,
    or
  - Asserting the request URL on the mocked transport
    (`api.xendit.co/...` vs `sandbox.duitku.com/...` — URL substring
    match is enough to prove routing).
- Also cover:
  - `merchant.payoutProvider` set to an unknown value → expect
    `PayoutService` to throw the "unknown provider" error from
    `resolveProvider`'s `default:` branch.
  - Missing `ProviderChannel` row for `(merchant.payoutChannelCode,
    country, merchant.payoutProvider)` → expect a structured error
    thrown before any transport call.

## Rules (non-negotiable)

- **Do not mock `PayoutService.resolveProvider` itself.** That is
  exactly the code under test. Mock the adapters' transport layer or
  the adapter's public methods, not the resolver.
- **Boot the real `PayoutModule`.** Importing `DuitkuPayoutProvider`
  and `XenditPayoutProvider` individually proves instantiation but
  not wiring — the whole value of this test is catching a missing
  `providers: [...]` or `useExisting: ...` entry.
- **Assert zero calls into the other adapter.** A test that says
  "Duitku was called" is weaker than "Duitku was called AND Xendit
  was not".
- **Unknown-provider case throws a typed error, not a raw
  `Error`.** Re-use the existing payout error taxonomy; reviewers
  should not see a `new Error("…")` sneak in.

## Acceptance

- [ ] Test boots `PayoutModule` with transport mocked.
- [ ] Case `payoutProvider: "xendit"` invokes the Xendit adapter's
      `triggerPayout`; Duitku's is never touched.
- [ ] Case `payoutProvider: "duitku"` invokes the Duitku adapter's
      `triggerPayout`; Xendit's is never touched.
- [ ] Case `payoutProvider: "unknown"` throws a typed error before
      any transport call.
- [ ] Missing `ProviderChannel` row throws a structured error before
      any transport call.
- [ ] No real network traffic (assert the transport mock was the
      only HTTP client used).

## Out of scope

- Verifying adapter behavior once routed — task 13 covers Duitku,
  existing Xendit spec covers Xendit.
- Sandbox e2e — task 16.
