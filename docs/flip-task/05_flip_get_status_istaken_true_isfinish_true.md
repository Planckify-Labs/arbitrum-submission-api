# Task 05 — `getStatus` via `GET /disbursement/{id}` + idempotency-key fallback + status mapping

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.4, §2.6, §5.1, §8

## Why this matters

Flip's webhook is the source of truth (same as Xendit), but unlike
Xendit's stubbed `getStatus`, Flip's `GET /disbursement/{id}` is a
real endpoint useful for: (1) webhook-missed edge cases, (2) manual
ops reconciliation, (3) dashboard status checks. Having a working
`getStatus` means we can actively verify payout status when webhooks
don't arrive, preventing payouts from staying in `PENDING` forever.

Flip also provides a second lookup path —
`GET /disbursement?idempotency_key={key}` — which resolves cases
where we never received the initial create-disbursement response
(network failure after Flip processed). This is a critical reconcile
fallback: if `providerPayoutId` is null (we never got Flip's ID),
we can still find the disbursement by the `intent.id` we sent as
the `idempotency-key`.

Unlike Duitku (which requires `getStatus` because it has no callback),
Flip's `getStatus` is a fallback — but a real, useful one.

**Depends on:** tasks 02 (env vars), 03 (adapter skeleton with
`buildAuthHeader`).

## Scope

### Primary: `getStatus` by disbursement ID

Implement `FlipPayoutProvider.getStatus(providerReferenceId: string):
Promise<TProviderStatusResult>` in
`src/payout/providers/flip-payout.provider.ts`:

1. `providerReferenceId` is the Flip disbursement ID (stored on
   `ProviderPayout.providerPayoutId` as a string, originally from
   `response.id` in `triggerPayout`).

2. **GET `${apiBase}/disbursement/${providerReferenceId}`** with headers:
   ```
   Authorization: Basic <base64(FLIP_SECRET_KEY:)>
   Accept: application/json
   ```

3. **Map `response.status`** to `TProviderStatus` per spec §5.1:
   - `DONE` → `COMPLETED`
   - `CANCELLED` → `FAILED`
   - `PENDING` (or any unrecognized value) → `PENDING`

4. Return `{ status, providerResponseCode: response.status,
   providerResponseBody: <raw JSON> }`.

5. **Error handling:**
   - 404 (unknown ID) → throw `PayoutProviderError({ kind: "not_found" })`
   - 401 → throw `PayoutProviderError({ kind: "auth_error" })`
   - 5xx → throw `PayoutProviderError({ kind: "server_error" })`

### Secondary: `getStatusByIdempotencyKey` reconcile fallback

Implement `FlipPayoutProvider.getStatusByIdempotencyKey(intentId: string):
Promise<TProviderStatusResult>`:

1. **GET `${apiBase}/disbursement?idempotency_key=${intentId}`** with
   the same auth headers.

2. Flip returns the disbursement object matching the idempotency key
   we originally sent (which is `intent.id`).

3. Same status mapping and return shape as `getStatus`.

4. **Error handling:**
   - 404 (no disbursement for this key) → throw
     `PayoutProviderError({ kind: "not_found" })`
   - Same 401/5xx handling as `getStatus`.

This method is NOT on the `IPayoutProviderAdapter` interface — it's
a Flip-specific utility method. The reconcile/ops layer can call it
when `providerPayoutId` is null (we never captured Flip's ID due to
a network failure after Flip processed the disbursement). Also
captures the `providerPayoutId` from the response for future lookups.

Flip's status model is intentionally simple — only three states
(`PENDING`, `DONE`, `CANCELLED`). No ambiguous codes like Duitku's
`68`/`TO`/`-100`. No special reconcile-hint plumbing needed.

## Rules (non-negotiable)

- **`getStatus` is a real implementation, not a stub.** Unlike Xendit's
  no-op, this method must hit Flip's API and return a real status.
- **Status mapping is case-insensitive.** Normalize with
  `.toUpperCase()` before the switch — defensive against Flip API
  changes.
- **Use the same `buildAuthHeader()` as `triggerPayout`.** Don't
  duplicate auth construction.
- **Do not poll in a loop inside `getStatus`.** The method is
  stateless — one call, one response, one mapping. Polling lives in
  the queue/reconcile layer.
- **`getStatusByIdempotencyKey` is NOT on the port interface.** It's
  a Flip-specific utility, not a generic adapter method.

## Acceptance

- [ ] `getStatus(providerReferenceId)` hits
      `${apiBase}/disbursement/${id}` with correct auth.
- [ ] `getStatusByIdempotencyKey(intentId)` hits
      `${apiBase}/disbursement?idempotency_key=${intentId}` with
      correct auth.
- [ ] Response status mapping: `DONE`→`COMPLETED`,
      `CANCELLED`→`FAILED`, `PENDING`→`PENDING`.
- [ ] Unknown/missing status defaults to `PENDING`.
- [ ] 404 → `not_found` error, 401 → `auth_error`, 5xx →
      `server_error`.
- [ ] Return shape matches the port type (`TProviderStatusResult`).
- [ ] `getStatusByIdempotencyKey` response includes
      `providerPayoutId` (Flip's `id`) for backfill.
- [ ] `pnpm run build` green.

## Out of scope

- Queue/reconcile scheduling — that's the service layer's concern,
  not the adapter's.
- Webhook handling — tasks 07, 08.
- Unit tests — task 09.
