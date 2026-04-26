# Task 06 — Retry discipline — exponential backoff, 4xx terminal, timeout handling

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §4.4

## Why this matters

Network failures, 5xx responses, and timeouts are inevitable in
production. The retry discipline ensures we handle transient failures
gracefully without double-disbursing. Flip's idempotent
`idempotency-key` header makes retries safe — Flip returns the
original transaction on duplicate keys. This task wraps the HTTP
calls in `triggerPayout` and `getStatus` with the standard retry
pattern used by Xendit/Duitku.

**Depends on:** task 03 (adapter skeleton), task 04 (`triggerPayout`
makes HTTP calls that need retry wrapping).

## Scope

Add retry logic to `FlipPayoutProvider`'s HTTP calls (both
`triggerPayout` POST and `getStatus` GET):

1. **Timeout:** 60s per request via `AbortController` — match existing
   adapters.

2. **Retry policy** (match Xendit/Duitku pattern):
   - 5xx responses → retry with exponential backoff
   - Network errors (fetch failures, DNS, connection reset) → retry
   - Timeouts (`AbortError`) → retry
   - Max 3 attempts: delays of 100ms, 400ms, 1600ms
   - 4xx responses → terminal, no retry (client errors won't resolve
     on retry)
   - 2xx responses → return immediately

3. **Implementation approach:** Follow whatever retry pattern the
   existing adapters use. If they use a shared `retryWithBackoff`
   helper, use that. If they inline the logic, follow the same shape
   for consistency. Do not introduce a new retry abstraction if one
   exists.

4. **Idempotency safety:** Retrying `POST /disbursement` is safe
   because the `idempotency-key` header ensures Flip returns the
   original transaction, not a duplicate. Document this in a brief
   inline note.

## Rules (non-negotiable)

- **Match existing adapter retry pattern exactly.** Do not invent a
  new approach — consistency across adapters matters for debugging.
- **4xx is always terminal.** A 401 (bad credentials) or 422
  (validation error) won't fix itself on retry.
- **60s timeout per attempt**, not per retry chain. Each attempt gets
  its own 60s window.
- **Exponential backoff: 100ms → 400ms → 1600ms.** Do not use
  fixed-interval retries.

## Acceptance

- [ ] `triggerPayout` HTTP call retries on 5xx/network/timeout.
- [ ] `getStatus` HTTP call retries on 5xx/network/timeout.
- [ ] 4xx responses are terminal — no retry.
- [ ] Max 3 attempts with 100ms, 400ms, 1600ms delays.
- [ ] Each attempt has a 60s timeout via `AbortController`.
- [ ] After exhausting retries, throws `PayoutProviderError` with
      appropriate `kind` (`server_error` or `timeout`).
- [ ] Retry pattern matches existing Xendit/Duitku adapters.
- [ ] `pnpm run build` green.

## Out of scope

- Queue-level retry (BullMQ job retries) — separate concern.
- Circuit breaker for Flip maintenance — deferred (spec §10).
- Unit tests — task 09.
