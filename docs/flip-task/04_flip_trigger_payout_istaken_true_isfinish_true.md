# Task 04 — `triggerPayout` — form-urlencoded disbursement + idempotency

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.4, §2.5, §2.6, §3 (delta vs existing), §4.3, §4.5, §5.1, §6

## Why this matters

This is the core of the Flip adapter — the single POST to
`/disbursement` that creates a payout. Unlike Duitku's two-step
inquiry→transfer flow, Flip is a one-shot disbursement (closer to
Xendit's model). The key differences from both existing adapters are:
(1) form-urlencoded body instead of JSON, (2) `idempotency-key` header
for dedup, and (3) an 18-character remark limit requiring truncation.

**Depends on:** tasks 01 (channel mapping), 02 (env vars), 03
(adapter skeleton with `buildAuthHeader` + `buildFormBody`).

## Scope

Implement `FlipPayoutProvider.triggerPayout(intent, merchant):
Promise<TPayoutReceipt>` in
`src/payout/providers/flip-payout.provider.ts`:

1. **Resolve Flip bank code** from `ProviderChannel` table:
   `ProviderChannel` row where `(channelCode, country) =
   (merchant.payoutChannelCode, merchant.country)` and
   `provider = 'flip'`. Use `providerChannelCode` (e.g. `"bca"`) as
   `bank_code` sent to Flip.

2. **Decrypt merchant account number** via the existing
   `account-number-crypto.ts` helper. Never log the plaintext.

3. **Build remark** — truncate to 18 characters max (spec §6):
   ```ts
   const remark = intent.id.slice(-18);
   ```
   ULIDs are 26 chars; the trailing 18 chars are the random component,
   unique enough for support triangulation.

4. **Build form-urlencoded body** via `buildFormBody()`:
   ```
   account_number=<decrypted>&bank_code=<flip_code>&amount=<intent.amountIdr>&remark=<truncated>
   ```

5. **POST to `/disbursement`** with headers:
   ```
   Authorization: Basic <base64(FLIP_SECRET_KEY:)>
   Content-Type: application/x-www-form-urlencoded
   Accept: application/json
   idempotency-key: <intent.id>
   ```
   - 60s timeout via `AbortController` (spec §4.4).
   - Flip returns the original transaction on duplicate
     `idempotency-key` values — retries on transport failures are safe.

6. **Map response to `TPayoutReceipt`:**
   - `providerPayoutId = String(response.id)` (Flip returns numeric ID).
   - `status = mapFlipStatus(response.status)`:
     - `PENDING` → `PENDING`
     - `DONE` → `COMPLETED`
     - `CANCELLED` → `FAILED`
   - `providerResponseCode = response.status`
   - `providerResponseBody = <raw JSON string>`
   - `fee = response.fee` (Flip returns the fee in the response)

7. **Handle errors:**
   - 401 → `PayoutProviderError({ kind: "auth_error" })`
   - 422 validation → `PayoutProviderError({ kind: "client_error",
     message: errors[0].message })`
   - 5xx / network / timeout → delegate to retry discipline (task 06);
     for this task, throw `PayoutProviderError({ kind: "server_error" })`

## Rules (non-negotiable)

- **`idempotency-key` header MUST equal `intent.id`.** This is the
  dedup key — same pattern as Xendit's `Idempotency-key` and Duitku's
  `custRefNumber`.
- **Form-urlencoded body, NOT JSON.** This is the most important
  difference from both existing adapters. Use `buildFormBody()` from
  task 03; never `JSON.stringify` the request body.
- **Remark max 18 characters.** Exceeding this causes a Flip 422
  validation error. Use `intent.id.slice(-18)`.
- **Never log** the plaintext account number, secret key, or
  authorization header. Redact at the log boundary.
- **No `if (providerName === …)` branches.** Everything in this method
  is Flip-specific inside a Flip-only adapter.
- **`response.id` is numeric.** Convert to string for
  `providerPayoutId` — the port type expects a string.

## Acceptance

- [ ] `triggerPayout` posts to `${apiBase}/disbursement` with
      form-urlencoded body.
- [ ] `Authorization` header uses Basic auth with trailing colon.
- [ ] `idempotency-key` header equals `intent.id`.
- [ ] `bank_code` is resolved via `ProviderChannel` where
      `provider = 'flip'`, never hardcoded.
- [ ] `remark` is truncated to max 18 characters.
- [ ] Response status is mapped: `PENDING`→`PENDING`,
      `DONE`→`COMPLETED`, `CANCELLED`→`FAILED`.
- [ ] `providerPayoutId` is `String(response.id)`.
- [ ] `TPayoutReceipt` shape is identical to Xendit/Duitku adapters —
      same keys, same enum values.
- [ ] 401/422/5xx errors produce appropriate `PayoutProviderError`.
- [ ] No plaintext account number, secret, or auth header appears in
      any logger call.
- [ ] `pnpm run build` green.

## Out of scope

- Retry logic with exponential backoff — task 06.
- `getStatus` reconcile — task 05.
- Webhook handling — tasks 07, 08.
- Unit tests — task 09.
- Bank account inquiry pre-check — deferred (spec §7).
