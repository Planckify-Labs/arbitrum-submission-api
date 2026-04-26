# Task 15 — `checkBalance` ops helper (`GET /general/balance`)

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.4 (endpoint table), §12.3 (sandbox integration — balance check)

## Why this matters

Flip charges per-disbursement fees deducted from the Flip Business
balance. Ops needs visibility into the remaining balance to avoid
failed payouts due to insufficient funds. This is the same pattern
as Duitku's `checkBalance` (Duitku task 18) — a non-critical ops
helper that should land before meaningful disbursement volume.

**Depends on:** task 03 (adapter skeleton with `buildAuthHeader`),
task 02 (env vars).

## Scope

Add a public method to `FlipPayoutProvider`:

```ts
async checkBalance(): Promise<{ balance: number }> {
  // GET ${apiBase}/general/balance
  // Auth: same Basic auth as all other endpoints
  // Response: { "balance": 1234567 }
}
```

This method is NOT on the `IPayoutProviderAdapter` interface — it's
a Flip-specific ops utility (same pattern as Duitku's `checkBalance`).

**Endpoint details:**
- `GET /general/balance`
- Auth: HTTP Basic Auth (same as disbursement)
- Response: `{ "balance": <number> }` — balance in IDR

**Exposure options** (pick whichever matches the Duitku pattern):
- Admin-only endpoint in the webhook controller or a dedicated ops
  controller
- CLI script callable via `pnpm run check-flip-balance`
- Both

**Error handling:**
- 401 → throw with clear message ("Flip auth failed — check FLIP_SECRET_KEY")
- 5xx → throw `PayoutProviderError({ kind: "server_error" })`

## Rules (non-negotiable)

- **NOT on `IPayoutProviderAdapter`.** This is provider-specific ops
  tooling, not part of the adapter contract.
- **Admin-only access.** Balance information is sensitive — guard with
  `@Roles(UserRole.ADMIN)` or equivalent if exposed as an endpoint.
- **Follow the Duitku `checkBalance` pattern exactly.** Same exposure
  method, same error handling shape.

## Acceptance

- [ ] `checkBalance()` method on `FlipPayoutProvider` hits
      `${apiBase}/general/balance` with correct auth.
- [ ] Returns `{ balance: number }`.
- [ ] 401 → clear error message.
- [ ] Accessible via admin endpoint or CLI script (matching Duitku
      pattern).
- [ ] Admin-only access enforced if exposed as an API endpoint.
- [ ] `pnpm run build` green.

## Out of scope

- Automated balance alerting — future ops work.
- Low-balance circuit breaker — future work.
- Unit tests for the balance helper — can be added to task 09's spec
  file or tested in sandbox e2e (task 12).
