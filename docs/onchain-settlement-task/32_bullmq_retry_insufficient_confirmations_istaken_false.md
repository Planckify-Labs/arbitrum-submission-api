# Task 32 — BullMQ re-enqueue for insufficient confirmations

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §8.2 (row: "Confirmations < required at first check")

## Why this matters

When a customer submits a txHash moments after broadcasting, the
transaction may not yet have enough confirmations. The spec requires
re-enqueueing via the `blockchain-verification` queue with 5 attempts
and exponential backoff — the same retry pattern used by the purchase
flow (`queue.module.ts:54-60`). Without this, the adapter either blocks
the HTTP request for minutes or permanently fails valid transactions.

## Scope

Wire the onchain settlement flow into the existing BullMQ retry
infrastructure:

1. **On timeout** from `waitForTransactionReceipt` (60s default):
   - Return `status: "SETTLING"` to the caller (202 HTTP).
   - Enqueue a retry job on the `blockchain-verification` queue (or a
     new `onchain-settlement` queue) with the `(intentId, txHash, chainId)`
     payload.

2. **Retry job processor:**
   - Re-run `OnchainSettlementProvider.settle()` with the same args.
   - If still insufficient confirmations → re-enqueue with backoff.
   - 5 attempts, exponential backoff (match existing purchase flow
     config at `queue.module.ts:54-60`).
   - On final failure → mark `OnchainSettlement.failureCode = "CONFIRMATION_TIMEOUT"`,
     intent stays `SIGNED` (not `FAILED` — customer can retry with the
     same or different txHash).

3. **Idempotency** — the adapter's `(intentId, txHash)` uniqueness check
   (task 18) ensures a retry that arrives after a prior success is a
   no-op.

4. **Mobile polling** — while the job retries in the background, mobile
   polls `GET /v1/pay/intents/:id` and sees `status: "SIGNED"` (or a
   new `"SETTLING"` status if added). When the job succeeds, status
   flips to `SETTLED` and the next poll picks it up.

## Rules (non-negotiable)

- **Reuse existing queue infrastructure.** Don't create a new queue
  framework — use BullMQ with the existing `queue.module.ts` registration
  pattern.
- **5 attempts, exponential backoff** — match the purchase flow's retry
  config.
- **Final failure does NOT mark intent `FAILED`** — the tx may still
  confirm later. Customer can retry.
- **Idempotency** — rely on the adapter's existing `(intentId, txHash)`
  check.

## Acceptance

- [ ] Timeout from `waitForTransactionReceipt` → job enqueued.
- [ ] Retry processor re-runs settlement verification.
- [ ] 5 attempts with exponential backoff.
- [ ] Final failure logs warning, does NOT mark intent `FAILED`.
- [ ] Successful retry flips intent to `SETTLED` and calls `kickPayout`.
- [ ] Unit test: mock timeout → assert job enqueued.
- [ ] `pnpm run build` passes.

## Out of scope

- The adapter's synchronous verification path (task 18 — this task
  handles only the async retry path).
- Queue infrastructure changes (reuse existing).
