# Task 09 — Response-code retry filter (`TO` / `68` / `-100` never retransmit)

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.6 (retry rule), §3 (retry discipline delta), §4.4

## Why this matters

Duitku's docs explicitly warn: **never retransmit** a transfer whose
`responseCode` is `TO`, `68`, or `-100`. A retransmission can result
in double-disbursement because Duitku may have queued the first
attempt for async settlement. This is different from Xendit, where
the adapter's retry loop is purely HTTP-status-driven. If we layer
Xendit-style retry onto Duitku, one insufficient-balance hiccup
becomes two real payouts to the beneficiary and we eat the
difference.

**Depends on:** tasks 07 (`triggerPayout` body), 08 (`getStatus` body
so reconcile is available).

## Scope

Edit `src/payout/providers/duitku-payout.provider.ts`:

Keep the Xendit-style **transport-layer** retry loop (100ms × 4^attempt,
MAX_ATTEMPTS=3) for HTTP 5xx, timeouts, and network errors. Layer on
top a **response-code filter** that runs on every 2xx response from
the `transfer` call:

```ts
const AMBIGUOUS_CODES = new Set(["TO", "68", "-100"]);

if (AMBIGUOUS_CODES.has(response.responseCode)) {
  // Do NOT retry transfer. Return PENDING with a reconcile hint.
  return {
    ...buildPendingReceipt(response, intent, merchant),
    reconcile: { disburseId, reason: response.responseCode },
  };
}
```

`PayoutService` reads the `reconcile` field on the returned receipt
and enqueues a `getStatus` job keyed by `disburseId` (task 08 already
has the enqueue plumbing; this task connects the hint).

Also apply the filter on HTTP-retry iterations: if attempt N returns a
2xx with `responseCode ∈ AMBIGUOUS_CODES`, bail out of the retry loop
immediately — do not sleep-and-retry the transfer.

## Rules (non-negotiable)

- **`TO` / `68` / `-100` are the forbidden retransmission codes.**
  Make the set a named `const` and import it from a single location.
  A future reader must not be able to "tidy up" the retry loop and
  accidentally exclude one of the three.
- **The filter runs on `transfer` responses only.** `inquiry` and
  `inquirystatus` can be retried on network errors under the normal
  transport policy — they are idempotent reads.
- **Do not expose the retry hint to callers as a new adapter
  method.** It rides on the `TPayoutReceipt` as a structured
  `reconcile` field (or equivalent), hidden behind the port type —
  callers see `PENDING` and nothing more.
- **Log the short-circuit at `warn` level** with `disburseId`,
  `responseCode`, `intentId`. Ops needs to surface these quickly; no
  secret/account material.
- **MAX_ATTEMPTS stays 3** for HTTP-layer failures. Don't dial it up
  "because Duitku's flaky"; if that proves true, it's a separate ops
  conversation.

## Acceptance

- [ ] `AMBIGUOUS_CODES = { "TO", "68", "-100" }` exists as a single
      named constant, used by both the first-response check and any
      retry-iteration check.
- [ ] On `transfer` response with `responseCode ∈ AMBIGUOUS_CODES`,
      the adapter returns a `PENDING` receipt carrying a `reconcile`
      hint — no additional `transfer` call is made.
- [ ] `PayoutService` enqueues a `getStatus` reconcile job when a
      receipt has a `reconcile` hint.
- [ ] HTTP 5xx / timeout / ECONNRESET still retries per the Xendit
      policy (100ms × 4^attempt, 3 attempts).
- [ ] A warn log is emitted on short-circuit, including `disburseId`,
      `responseCode`, `intentId`, with no secret material.
- [ ] Unit test (stub in task 13) asserts zero retransmissions when
      the first transfer returns `responseCode: "68"`.

## Out of scope

- Tuning reconcile backoff / max attempts in the queue — ops concern.
- Adding the filter to `inquiry` or `inquirystatus` — those are
  idempotent, normal retry applies.
- Full unit coverage of the retry matrix — task 13.
