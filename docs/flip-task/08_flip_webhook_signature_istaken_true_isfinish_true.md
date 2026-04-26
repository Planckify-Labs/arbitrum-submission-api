# Task 08 — `verifyWebhookSignature` — token + optional HMAC verification

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.7, §4.3, §11

## Why this matters

Webhook verification prevents spoofed callbacks from triggering
payouts. Flip uses a static `token` field in the callback body
(similar to Xendit's `x-callback-token` header). The verification
must use constant-time comparison to prevent timing attacks — same
security discipline as the Xendit adapter.

**Depends on:** task 02 (env vars — `FLIP_VALIDATION_TOKEN`), task 03
(adapter skeleton).

## Scope

Implement `FlipPayoutProvider.verifyWebhookSignature(headers, body):
boolean` in `src/payout/providers/flip-payout.provider.ts`:

1. **Extract `token`** from the parsed form body. The webhook
   controller (task 07) passes the raw form fields.

2. **Constant-time comparison** of the received `token` against
   `FLIP_VALIDATION_TOKEN` from config:
   ```ts
   const expected = Buffer.from(this.config.validationToken, "utf8");
   const received = Buffer.from(token ?? "", "utf8");
   if (expected.length !== received.length) return false;
   return crypto.timingSafeEqual(expected, received);
   ```
   Use `timingSafeEqual` — same pattern as Xendit's
   `x-callback-token` verification.

3. **Missing token → return `false`.**
   Empty string or `undefined` token is an invalid callback.

4. **(Future) `Webhook-Signature` header verification:**
   Flip's newer implementation sends additional security headers:
   - `Webhook-Id` — for idempotent handling
   - `Webhook-Signature` — body HMAC signature
   - `Webhook-Timestamp` — UNIX timestamp for replay protection

   For v1, log these headers if present but do NOT verify them — the
   HMAC scheme (algorithm, signing key, body format) needs confirmation
   from Flip docs (spec §14 open question 3). Add a TODO marker so
   task 08 follow-up can find it.

## Rules (non-negotiable)

- **`timingSafeEqual`, not `===`.** String equality comparison leaks
  timing information — same rule as Xendit adapter.
- **Buffer length check before `timingSafeEqual`.** The function
  throws if buffers have different lengths — guard with an explicit
  length comparison first.
- **Never log the validation token.** Not in debug, not in error
  paths, not in "received vs expected" diagnostics.
- **Return `boolean`, not throw.** The webhook controller handles
  the 401/403 response; the adapter just answers "is this signature
  valid?"

## Acceptance

- [ ] `verifyWebhookSignature` extracts `token` from the callback body.
- [ ] Comparison uses `crypto.timingSafeEqual` with Buffer encoding.
- [ ] Missing/empty token → returns `false`.
- [ ] Valid token → returns `true`.
- [ ] `FLIP_VALIDATION_TOKEN` sourced from `ConfigService`, not
      `process.env`.
- [ ] Validation token is never logged.
- [ ] `Webhook-Signature`, `Webhook-Id`, `Webhook-Timestamp` headers
      are logged (if present) but not verified in v1.
- [ ] `pnpm run build` green.

## Out of scope

- `Webhook-Signature` HMAC verification — deferred pending Flip docs
  clarification (spec §14 open question 3).
- `Webhook-Timestamp` replay protection (reject > 5 min old) —
  deferred (spec §11 item 5).
- Webhook endpoint routing — task 07.
- Unit tests — task 10.
