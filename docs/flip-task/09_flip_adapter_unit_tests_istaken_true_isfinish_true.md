# Task 09 — Adapter unit tests — happy path, errors, serialization, remark truncation

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §12.1

## Why this matters

The adapter is the riskiest code in the payout flow — it handles
money movement, external API calls, and status mapping. Comprehensive
unit tests catch regressions before they reach sandbox or production.
This mirrors the Duitku adapter test suite (task 13 in the Duitku
backlog).

**Depends on:** tasks 03–06 (adapter implementation complete),
task 15 (if `checkBalance` is implemented before tests).

## Scope

Create/expand `src/payout/providers/flip-payout.provider.spec.ts`:

Mock `fetch` via constructor injection (same pattern as Xendit/Duitku
adapter specs).

### `triggerPayout` tests

- **Happy path:** 200 response with `status: "PENDING"` → returns
  `TPayoutReceipt` with `status: "PENDING"`, `providerPayoutId` is
  stringified numeric ID, `providerResponseCode: "PENDING"`.
- **Form-urlencoded body correctness:** Assert the request body is
  `application/x-www-form-urlencoded`, not JSON. Verify `account_number`,
  `bank_code`, `amount`, `remark` fields are present and correctly
  encoded.
- **Idempotency header:** Assert `idempotency-key` header equals
  `intent.id`.
- **Basic auth header:** Assert `Authorization` header is
  `Basic <base64(secretKey:)>` with trailing colon.
- **Remark truncation:** Assert remark is `intent.id.slice(-18)` and
  never exceeds 18 characters.
- **Bank code resolution:** Assert `bank_code` comes from
  `ProviderChannel` lookup, not hardcoded.
- **401 error:** → `PayoutProviderError` kind `auth_error`.
- **422 validation error:** → `PayoutProviderError` kind `client_error`
  with message from error response.
- **503 maintenance:** → retry (if retry is inline) then
  `PayoutProviderError` kind `server_error`.
- **Timeout:** `AbortError` → `PayoutProviderError` kind `timeout`.
- **Status mapping:** Test all three states:
  - `PENDING` → `PENDING`
  - `DONE` → `COMPLETED`
  - `CANCELLED` → `FAILED`

### `getStatus` tests

- **Happy path:** 200 with `status: "DONE"` → `COMPLETED`.
- **Pending status:** 200 with `status: "PENDING"` → `PENDING`.
- **Cancelled status:** 200 with `status: "CANCELLED"` → `FAILED`.
- **Case-insensitive mapping:** `"done"` (lowercase) → `COMPLETED`.
- **Unknown status string:** Unrecognized value → defaults to `PENDING`.
- **404 unknown ID:** → `PayoutProviderError` kind `not_found`.
- **Auth header correctness:** Same Basic auth as `triggerPayout`.

### `getStatusByIdempotencyKey` tests

- **Happy path:** 200 with matching disbursement → returns status +
  `providerPayoutId` (Flip's numeric `id` as string).
- **404 no match:** No disbursement for this idempotency key →
  `PayoutProviderError` kind `not_found`.
- **URL construction:** Assert query param is
  `?idempotency_key=${intentId}`, properly URL-encoded.
- **Auth header correctness:** Same Basic auth as other methods.

### `checkBalance` tests (if task 15 is complete)

- **Happy path:** 200 with `{ "balance": 1234567 }` → returns
  `{ balance: 1234567 }`.
- **401 auth error:** → clear error message.
- **Auth header correctness:** Same Basic auth as other methods.

### `verifyWebhookSignature` tests

- **Valid token:** Returns `true`.
- **Invalid token:** Returns `false`.
- **Missing token:** Returns `false`.
- **Empty string token:** Returns `false`.
- **Timing-safe:** Assert `crypto.timingSafeEqual` is used (mock and
  verify call).

### Security / redaction tests

- **No plaintext account number in logs:** Mock the logger and assert
  no log call contains the decrypted account number.
- **No secret key in logs:** Assert `FLIP_SECRET_KEY` never appears
  in any log output.

## Rules (non-negotiable)

- **Mock `fetch`, not HTTP.** Match the test pattern used by existing
  adapter specs.
- **Test the form-urlencoded body, not just the response.** The
  serialization format is the biggest difference from other adapters.
- **Assert on `providerPayoutId` type.** It must be a string, even
  though Flip returns a numeric ID.
- **Each test case is independent.** No shared mutable state between
  tests.

## Acceptance

- [ ] All `triggerPayout` test cases pass.
- [ ] All `getStatus` test cases pass.
- [ ] All `getStatusByIdempotencyKey` test cases pass.
- [ ] All `verifyWebhookSignature` test cases pass.
- [ ] `checkBalance` test cases pass (if task 15 complete).
- [ ] Security/redaction tests pass.
- [ ] Form-urlencoded body format is explicitly asserted.
- [ ] Remark truncation to 18 chars is explicitly asserted.
- [ ] `pnpm run test -- --testPathPattern=flip-payout.provider` green.

## Out of scope

- Webhook controller tests — task 10.
- Module wiring integration test — task 11.
- Sandbox e2e — task 12.
