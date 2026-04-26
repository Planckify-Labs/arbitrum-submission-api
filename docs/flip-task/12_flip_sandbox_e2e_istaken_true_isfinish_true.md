# Task 12 — Sandbox e2e (gated `RUN_FLIP_SANDBOX_E2E=1`)

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.10, §12.3

## Why this matters

Unit tests with mocked HTTP verify our code logic but not the actual
Flip API contract. A sandbox e2e test catches: (1) request format
mismatches (especially the form-urlencoded body), (2) auth header
construction errors, (3) response shape changes. Gating behind an
env flag keeps CI fast while allowing manual validation.

**Depends on:** tasks 03–06 (adapter fully implemented), task 02
(env vars wired).

## Scope

Create `src/payout/providers/flip-payout.provider.e2e.spec.ts`
(or follow the existing Duitku e2e pattern):

1. **Gate:** Skip all tests unless `process.env.RUN_FLIP_SANDBOX_E2E === "1"`.

2. **Setup:** Instantiate `FlipPayoutProvider` with real sandbox
   credentials:
   - `FLIP_SECRET_KEY` — sandbox key from Flip dashboard
   - `FLIP_API_BASE` — `https://bigflip.id/big_sandbox_api/v2`

3. **Test: Create disbursement:**
   - POST to `/disbursement` with a valid sandbox account.
   - Assert response contains: `id` (numeric), `status: "PENDING"`,
     `bank_code`, `amount`, `fee`.
   - Assert `providerPayoutId` is captured correctly.

4. **Test: Get disbursement status:**
   - GET `/disbursement/{id}` using the ID from step 3.
   - Assert response contains `status: "PENDING"` (sandbox doesn't
     auto-complete — requires manual "Force Success" in dashboard).

5. **Test: Idempotent retry:**
   - POST to `/disbursement` with the same `idempotency-key`.
   - Assert response returns the original transaction (same `id`).

6. **Test: Get disbursement by idempotency key:**
   - GET `/disbursement?idempotency_key={key}` using the `intent.id`
     from step 3.
   - Assert response returns the same disbursement (same `id`).
   - Verifies the reconcile fallback path works.

7. **Test: Get balance:**
   - GET `/general/balance` — verify auth header works and response
     contains `balance` field (numeric).

8. **Test: Invalid auth:**
   - POST with a wrong secret key.
   - Assert 401 response.

### Sandbox behavior notes (spec §2.10)

- Disbursements always return `PENDING` status.
- Use the Flip sandbox dashboard to simulate `DONE` or `CANCELLED`
  via "Force Success" / "Force Failed" buttons.
- Callbacks fire after manual simulation — cannot be automated in
  this test.
- Sandbox provides simulated balance.

## Rules (non-negotiable)

- **Gated behind `RUN_FLIP_SANDBOX_E2E=1`.** This test must NEVER
  run in CI by default — it hits a real external API.
- **Do not commit sandbox credentials.** Use env vars, not hardcoded
  values.
- **Sandbox disbursements cost nothing** but pollute the sandbox
  account — use small amounts and descriptive remarks.
- **Do not test webhook callbacks here.** Sandbox callbacks require
  manual dashboard interaction; webhook e2e is a manual test.

## Acceptance

- [ ] Test file exists and is skipped when `RUN_FLIP_SANDBOX_E2E`
      is not set.
- [ ] Create disbursement returns `PENDING` with a numeric `id`.
- [ ] Get status by ID returns a valid response for the created
      disbursement.
- [ ] Idempotent retry returns the same `id`.
- [ ] Get status by idempotency key returns the same disbursement.
- [ ] Get balance returns a numeric `balance` field.
- [ ] Invalid auth returns 401.
- [ ] All tests pass with sandbox credentials:
      `RUN_FLIP_SANDBOX_E2E=1 pnpm run test -- --testPathPattern=flip-payout.provider.e2e`

## Out of scope

- Webhook callback testing — requires manual Flip dashboard interaction.
- Production validation — separate checklist.
- Automated CI integration — the gate flag keeps this manual-only.
