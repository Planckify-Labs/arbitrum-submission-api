# Task 29 — Abandon-on-refresh + QUOTED intent expiry sweeper for onchain rail

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.9

## Why this matters

When a customer lets a quote expire and mobile auto-fires a new
`POST /v1/pay/intents`, the old intent sits in `QUOTED` status until
the sweeper reaps it. Without abandon-on-refresh, the audit trail shows
orphaned intents that look like they were never resolved. Without a
sweeper tuned for the 15-minute onchain TTL, expired `direct_arc`
intents linger indefinitely.

## Scope

### Abandon-on-refresh (recommended, not required for correctness)

In `IntentsService.createIntent`, after persisting the new intent:

- Query for prior intents matching `(payerUserId, merchantId, status = "QUOTED")`.
- If found and `id !== newIntent.id`, mark them `EXPIRED` with a
  `failureCode = "SUPERSEDED_BY_REFRESH"`.
- This is fire-and-forget — failure to mark the old intent does not
  block the new one.

### QUOTED+expiresAt sweeper

The spec references a sweeper using `@@index([status, expiresAt])`
(`schema.prisma:910`). Verify this sweeper:

1. **Exists** — check if a cron or BullMQ job already reaps expired
   `QUOTED` intents. If yes, confirm it handles the 15-minute onchain
   TTL correctly (existing nanopay TTL is ~3 days).
2. **Handles both rails** — the sweeper must not assume a single TTL.
   It should use `expiresAt < now()` regardless of `path`.
3. **If no sweeper exists**, implement one as a BullMQ repeatable job
   (every 5 minutes, batch of 100, mark `EXPIRED`).

### Re-quote flow verification

Verify the full re-quote cycle from §4.9:
- Fresh `Idempotency-Key` per refresh → fresh intent.
- Old intent times out → sweeper reaps it.
- Same `(payer, merchant)` pair can have multiple sequential intents.

## Rules (non-negotiable)

- **Abandon-on-refresh is best-effort.** If the query fails, the new
  intent still succeeds. The sweeper is the safety net.
- **Sweeper uses `expiresAt`**, not a hardcoded TTL from the intent's
  creation time.
- **`@@index([status, expiresAt])`** must exist (verify in schema).

## Acceptance

- [ ] Abandon-on-refresh marks prior `QUOTED` intents as `EXPIRED`.
- [ ] Sweeper reaps `QUOTED` intents past `expiresAt` for both rails.
- [ ] Unit test: create two intents for same `(payer, merchant)` → first
      is `EXPIRED` after second is created.
- [ ] Sweeper test: intent with `expiresAt` in the past → marked
      `EXPIRED`.
- [ ] `pnpm run build` and `pnpm run test` pass.

## Out of scope

- On-chain enforcement of expiry (contract handles `QUOTE_EXPIRED` revert — task 01).
- Mobile countdown UX.
