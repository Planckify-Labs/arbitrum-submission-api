# Task 13 — Adapter unit tests: happy path, name mismatch, retry, redaction

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §7 bullets 2–6

## Why this matters

The adapter's logic branches are load-bearing: the holder-name guard
prevents sending money to the wrong account, the `TO`/`68`/`-100`
short-circuit prevents double-disbursement, and the redaction
discipline prevents secrets leaking into production logs. Each needs
a regression test — they are the kind of behavior that silently
breaks if someone "cleans up" the code a year from now.

**Depends on:** tasks 05, 06, 07, 08, 09.

## Scope

Create `src/payout/providers/duitku-payout.provider.spec.ts` — mirrors
the file layout of `xendit-payout.provider.spec.ts`.

Cases (minimum):

1. **Happy path:** mock `httpFetch` (or whatever transport wrapper)
   returning:
   - Inquiry `responseCode: "00"`, `accountName = merchant.payoutAccountHolderName`
   - Transfer `responseCode: "00"`
   Assert the returned `TPayoutReceipt`:
   - `status: "COMPLETED"`
   - Keys identical to the Xendit adapter's receipt (run a deep
     `Object.keys` diff against a Xendit receipt fixture).
   - `providerPayoutId` = the Duitku `disburseId` from inquiry.
   - `providerResponseCode: "00"`.

2. **Name mismatch:** mock inquiry returning `accountName = "Someone
   Else"`. Assert:
   - Transfer is **never** called (spy on the transport for `/transfer`).
   - Throws `PayoutProviderError({ kind: "client_error" })`.

3. **Response-code short-circuit — `68`:** mock transfer returning
   `responseCode: "68"`. Assert:
   - Adapter returns a `PENDING` receipt with the `reconcile` hint.
   - `/transfer` is called **exactly once** (no retransmit).
   - A warn log fired with `disburseId`, `responseCode`, `intentId`,
     and contains no secret / account-number material.

4. **Response-code short-circuit — `TO`:** same structure as case 3
   with `responseCode: "TO"`. Single call, `PENDING` receipt.

5. **Response-code short-circuit — `-100`:** same, with operational
   alert assertion.

6. **Transport retry still works for 5xx:** mock transfer returning
   HTTP 503 on attempt 1 and `responseCode: "00"` on attempt 2.
   Assert final receipt is `COMPLETED` and the transport was called
   twice.

7. **Transport retry cap:** 5xx on all three attempts → throws
   `PayoutProviderError({ kind: "server_error" })`.

8. **`getStatus` happy path:** mock `inquirystatus` returning
   `responseCode: "00"`; assert `TProviderStatus.status ===
   "COMPLETED"`.

9. **`getStatus` ambiguous:** mock `responseCode: "68"`; assert
   `status: "PENDING"` (no operational alert).

10. **`getStatus` -100:** mock `responseCode: "-100"`; assert
    `status: "PENDING"` and `operationalAlert: true`.

11. **Secret redaction:** inject a failing-network mock. Capture the
    logger output. Assert:
    - `DUITKU_DISB_SECRET_KEY` value never appears.
    - The plaintext account number never appears (neither the raw
      bytes decoded nor the `bankAccount` field).
    - The computed signature hex never appears (it encodes the secret
      indirectly; reviewer can argue either way, but safer to redact).

12. **`verifyWebhookSignature` returns `false`:** trivial — one-liner
    assertion.

Helper: build a `makeMerchant({ overrides })` and
`makeIntent({ overrides })` factory to avoid duplicating fixtures
across cases.

## Rules (non-negotiable)

- **Mock only the transport and logger.** Do not mock
  `DuitkuPayoutProvider`'s own methods — that defeats the point.
- **Freeze time** (`jest.useFakeTimers` / fixed `Date.now`) for any
  test that asserts on `timestamp` or `completedAt`.
- **Real signature computation.** Let `buildSignature` run
  end-to-end — do not stub it. The signature is part of the request
  body and tests that it ends up on the wire.
- **Zero network activity.** If a test accidentally hits
  `sandbox.duitku.com`, it must fail loudly in CI (transport factory
  returns an explicit mock; production `httpFetch` is never imported
  by the spec).
- **Redaction assertions are hard-asserts**, not toleration ranges.
  The secret value either appears in a captured log line or it
  doesn't — no `.toContain` shortcuts that might match partially.

## Acceptance

- [ ] All 12 cases above are covered with distinct test names.
- [ ] Coverage on `src/payout/providers/duitku-payout.provider.ts` >
      90% lines.
- [ ] Shape parity with Xendit receipt asserted via deep key-set diff.
- [ ] Redaction test captures logger output and asserts secret +
      plaintext account number + signature are absent.
- [ ] `pnpm run test -- --testPathPattern=duitku-payout.provider`
      green.

## Out of scope

- Live sandbox e2e — task 16.
- Module-wiring (provider-routing) test — task 14.
