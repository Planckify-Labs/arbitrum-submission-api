# Task 10 — Webhook controller tests — token verification, status mapping, idempotency

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §12.2

## Why this matters

The webhook endpoint is the primary path for payout status updates.
A bug here means payouts stay in `PENDING` forever or, worse,
double-process. These tests verify the full flow from form-urlencoded
body reception through token verification to DB persistence.

**Depends on:** tasks 07 (webhook endpoint), 08 (signature
verification).

## Scope

Add Flip webhook test cases to
`src/payout/webhook.controller.spec.ts` (or create a separate
`webhook.controller.flip.spec.ts` if the existing file is large):

### Test cases

- **Valid token + DONE:** Form body with valid `token` and
  `data` containing `status: "DONE"` → `ProviderPayout` updated to
  `COMPLETED`, `PaymentIntent` updated to `PAID_OUT`. Response 200.

- **Valid token + CANCELLED:** `status: "CANCELLED"` →
  `ProviderPayout` updated to `FAILED`. Intent stays in current state
  (e.g. `SETTLED`). Response 200.

- **Missing token:** Body with no `token` field → 401 response. No
  DB writes.

- **Invalid token:** Body with wrong `token` value → 403 response.
  No DB writes.

- **Unknown disbursement ID:** `data` contains an `id` not in our
  `ProviderPayout` table → 404 response. No DB writes.

- **Idempotent re-delivery:** Callback arrives for a `ProviderPayout`
  already in `COMPLETED` state → 200 response, no state change, no
  side effects.

- **Form-urlencoded body parsing:** Assert the endpoint correctly
  parses `data=<url-encoded JSON string>&token=<token>`. Verify
  two-stage parsing: form decode → JSON parse of `data` field.

- **Malformed `data` JSON:** `data` field is not valid JSON → 400
  response.

- **PENDING status in callback:** (Shouldn't normally happen but
  handle gracefully) → 200 no-op, no state change.

### Security assertions

- **Token verification happens before DB lookup.** Mock the DB layer
  and assert it's not called when token verification fails.
- **Parsed `data` is validated** — required fields (`id`, `status`)
  must be present. Missing fields → 400.

## Rules (non-negotiable)

- **Test with `application/x-www-form-urlencoded` content type.** Do
  not send JSON bodies — the endpoint must handle form encoding.
- **Two-stage parsing must be tested.** The `data` field is a JSON
  string inside form encoding — this is the most error-prone part.
- **Idempotency is mandatory.** Flip retries 5 times — duplicate
  callbacks are guaranteed in production.

## Acceptance

- [ ] All test cases listed above pass.
- [ ] Form-urlencoded content type is used in test requests.
- [ ] Two-stage parsing (form → JSON) is explicitly tested.
- [ ] Token verification ordering is asserted (before DB access).
- [ ] Idempotent re-delivery returns 200 with no state change.
- [ ] `pnpm run test -- --testPathPattern=webhook` green.

## Out of scope

- `Webhook-Signature` HMAC tests — deferred with the feature.
- Replay protection tests — deferred with the feature.
- Sandbox e2e — task 12.
