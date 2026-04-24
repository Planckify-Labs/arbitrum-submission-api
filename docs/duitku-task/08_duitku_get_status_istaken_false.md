# Task 08 — `getStatus` via `inquirystatus` + response-code → status map

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.3, §2.6, §3 (delta vs Xendit — `getStatus` must be implemented)

## Why this matters

Xendit's `getStatus` is stubbed because its callback is the source of
truth. Duitku RTOL has **no callback** — when a transfer returns `68`
(pending) or `TO` (timeout) we have to actively poll `inquirystatus`
to resolve the outcome. Without a working `getStatus`, an ambiguous
transfer hangs forever in `PENDING`. This is the difference between
"payouts sometimes stay pending for 10 minutes" and "payouts
occasionally stay pending permanently until ops intervenes".

**Depends on:** tasks 05 (signature helper), 06 (adapter skeleton),
07 (adapter trigger path populates `providerPayoutId = disburseId`).

## Scope

Implement `DuitkuPayoutProvider.getStatus(providerReferenceId: string):
Promise<TProviderStatus>` in
`src/payout/providers/duitku-payout.provider.ts`:

1. `providerReferenceId` here is the `disburseId` returned from the
   original inquiry step (stored on `ProviderPayout.providerPayoutId`).
2. POST `${apiBase}/inquirystatus` with `{ userId, email, timestamp,
   disburseId, signature }`, signed via `buildSignature("inquiryStatus",
   { email, timestamp, disburseId, secretKey })`.
3. Map `response.responseCode` to `TProviderStatus` per research §2.6:
   - `00` → `COMPLETED`
   - `80` → `PROCESSING`
   - `68` / `TO` → `PENDING` (stay pending; the next reconcile tick
     polls again)
   - `-100` → `PENDING` with an `operationalAlert: true` flag (flagged
     for ops but not FAILED until support confirms)
   - `01` / `-510` / `-141` / `-148` / `-149` / `-192` / `-420` / `76`
     → `FAILED` terminal
   - `-191` / `-213` / `-930` / `-960` / `-951` / `-952` / `-920` → adapter-level
     errors; throw `PayoutProviderError({ kind })` per §2.6 matrix.
4. Return `{ status, providerResponseCode, providerResponseBody }`
   shaped like `TProviderStatus` (match the port type; if the current
   port only returns a status enum, extend it minimally to carry the
   response code + body without breaking the Xendit impl).

Enqueueing reconciles:

- `PayoutService` should enqueue a reconcile job whenever a
  `ProviderPayout` lands in `PENDING` with
  `provider = 'duitku'`. Add a small scheduling hook in
  `persistSuccess`/`persistFailure` (or the BullMQ producer used
  today) gated by `merchant.payoutProvider === "duitku"` and
  `status === "PENDING"`. The actual job handler calls
  `getStatus(disburseId)`. If the port is extended, this plumbing can
  be generic — prefer generic.

## Rules (non-negotiable)

- **`getStatus` is required, not optional, for Duitku.** Do not merge
  a version that throws `NotImplementedError` — a live intent can
  depend on the reconcile path.
- **Do not retry `-100` as a transfer.** `-100` in `getStatus` means
  "unknown, escalate to support"; mapping to `PENDING +
  operationalAlert` is the right signal. Never call `transfer` again
  to resolve it — research §2.6 explicitly warns against
  retransmission.
- **Reconcile backoff lives in the queue config**, not inside
  `getStatus` itself. Keep the adapter method stateless — one call,
  one response, one mapping.
- **Do not polyfill `inquirystatus` with response-body probing from
  the original transfer response.** Probe the live endpoint; stale
  data is the entire failure class we're trying to avoid.

## Acceptance

- [ ] `getStatus(disburseId)` hits `${apiBase}/inquirystatus` with a
      correctly-signed body.
- [ ] Response-code → `TProviderStatus` mapping matches research §2.6.
- [ ] `-100` returns `PENDING` with an `operationalAlert` flag; logs
      include a structured warning (no secret material).
- [ ] Non-terminal Duitku rows get enqueued for reconcile by
      `PayoutService` — verified by a unit test in task 13 or 14.
- [ ] Port type `TProviderStatus` carries `providerResponseCode` and
      `providerResponseBody`; existing Xendit impl still compiles.
- [ ] `pnpm run test` green.

## Out of scope

- Response-code retry filter inside `triggerPayout` — task 09.
- Queue/reconcile retention policy and backoff tuning — separate ops
  task, not blocking.
- Full Duitku sandbox validation — task 16.
