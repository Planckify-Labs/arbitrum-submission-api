# Task 07 — `POST /webhooks/flip` endpoint with form-urlencoded parsing

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.7, §3 (delta — callback format), §4.6, §5.2

## Why this matters

Flip sends webhook callbacks when a disbursement reaches `DONE` or
`CANCELLED`. This is the source of truth for payout status (same as
Xendit). Without this endpoint, payouts would stay in `PENDING`
until manual reconciliation via `getStatus`. The critical difference
from Xendit: Flip sends `application/x-www-form-urlencoded` bodies
with a JSON-encoded `data` field, requiring two-stage parsing.

**Depends on:** task 03 (adapter skeleton), task 08 (webhook
signature verification — can develop in parallel if the endpoint
delegates verification to the adapter).

## Scope

Edit `src/payout/webhook.controller.ts`:

Add `POST /webhooks/flip` endpoint:

1. **Body parsing:** Flip sends `Content-Type: application/x-www-form-urlencoded` with two fields:
   - `data` — JSON-encoded string containing the full disbursement object
   - `token` — validation token (static shared secret)

   Configure the route to accept `application/x-www-form-urlencoded`.
   NestJS's default JSON parser may interfere — use `@Body()` with the
   built-in urlencoded parser, or a raw body decorator if needed.

2. **Two-stage parsing:**
   - Stage 1: Extract `data` (string) and `token` (string) from the
     form body.
   - Stage 2: `JSON.parse(data)` to get the disbursement object.

3. **Token verification:** Delegate to
   `flipProvider.verifyWebhookSignature(headers, body)` (task 08).
   If verification fails → return 401/403.

4. **Extract status:** From the parsed `data` JSON:
   - `id` — Flip's numeric disbursement ID
   - `status` — `"DONE"` or `"CANCELLED"`

5. **Look up `ProviderPayout`** by
   `providerPayoutId = String(id)` and `provider = "flip"`.
   If not found → return 404.

6. **Map status and persist** (same logic as Xendit webhook):
   - `DONE` → `ProviderPayoutStatus.COMPLETED` → update
     `PaymentIntent` to `PAID_OUT`
   - `CANCELLED` → `ProviderPayoutStatus.FAILED` → intent stays
     `SETTLED` (or whatever the current status is)
   - `PENDING` → no-op (shouldn't happen in callbacks, but handle
     gracefully)

7. **Idempotent re-delivery:** If the `ProviderPayout` is already in a
   terminal state (`COMPLETED`/`FAILED`), return 200 without updating.
   Flip retries 5 times at 2-minute intervals — we must handle
   duplicates.

8. **Return 200** on success. Any non-200 response triggers Flip's
   retry.

Additional webhook headers (spec §2.7):
- `Webhook-Id` — log for debugging, use for idempotent handling if
  present.
- `Webhook-Timestamp` — log for debugging. Replay protection is a
  follow-up.
- `Webhook-Signature` — verification is a follow-up (task 08 handles
  the `token` field first).

## Rules (non-negotiable)

- **`data` field is a JSON string inside a form-urlencoded body.** This
  two-stage parsing is mandatory — do not assume JSON body.
- **Always return 200 on successful processing.** Non-200 triggers
  Flip's retry, which can cause duplicate processing attempts.
- **Idempotent re-delivery handling.** Flip retries 5 times — the
  endpoint must handle the same callback arriving multiple times without
  side effects.
- **Token verification before any DB writes.** Reject unauthenticated
  callbacks before looking up `ProviderPayout`.
- **`JSON.parse(data)` must be wrapped in try-catch.** A malformed
  `data` field should return 400, not crash the endpoint.

## Acceptance

- [ ] `POST /webhooks/flip` endpoint exists in the webhook controller.
- [ ] Route accepts `application/x-www-form-urlencoded` content type.
- [ ] `data` field is parsed as JSON (two-stage parsing).
- [ ] Token verification delegates to adapter's
      `verifyWebhookSignature`.
- [ ] `DONE` → `ProviderPayout.COMPLETED` + `PaymentIntent.PAID_OUT`.
- [ ] `CANCELLED` → `ProviderPayout.FAILED`.
- [ ] Already-terminal `ProviderPayout` → 200 no-op.
- [ ] Unknown disbursement ID → 404.
- [ ] Missing/invalid token → 401/403.
- [ ] Malformed `data` JSON → 400.
- [ ] `pnpm run build` green.

## Out of scope

- `Webhook-Signature` HMAC verification — task 08 / deferred.
- `Webhook-Timestamp` replay protection — deferred (spec §11 item 5).
- Unit tests — task 10.
