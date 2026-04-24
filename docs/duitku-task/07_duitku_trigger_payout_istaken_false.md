# Task 07 — `triggerPayout` — inquiry + transfer with holder-name guard

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.3, §2.5, §2.6 (response codes), §3 (delta vs Xendit), §4.3

## Why this matters

This is the core of the adapter — the two-step inquiry→transfer flow
that actually moves money. Duitku's `inquiry` returns the real
account-holder name the bank reports; comparing it to
`merchant.payoutAccountHolderName` before calling `transfer` is our
only defense against disbursing to a correctly-entered-but-wrong
account. The whole point of the port is that this complexity hides
behind a single `triggerPayout(intent, merchant)` method so
`PayoutService` keeps calling one adapter method regardless of
provider.

**Depends on:** tasks 05 (signature helper), 06 (adapter skeleton).

## Scope

Implement `DuitkuPayoutProvider.triggerPayout(intent, merchant):
Promise<TPayoutReceipt>` in
`src/payout/providers/duitku-payout.provider.ts`:

1. Resolve the merchant's provider channel:
   `ProviderChannel` row where `(channelCode, country) =
   (merchant.payoutChannelCode, merchant.country)` and
   `provider = 'duitku'`. Use `providerChannelCode` (e.g. `"014"` for
   BCA) as the `bankCode` sent to Duitku.
2. Decrypt `merchant.payoutAccountNumber` via the existing
   `account-number-crypto.ts` helper. Never log the plaintext.
3. Build `timestamp` (Unix ms) via `buildTimestamp()` from task 05.
4. **Inquiry step** — POST `${apiBase}/inquiry` (or `/inquirysandbox`
   in non-prod, inferred from `apiBase`) with:
   - `userId`, `email`, `timestamp`
   - `bankCode`, `bankAccount` (plaintext), `amountTransfer`,
     `purpose` (e.g. intent id or a short label), `signature`
   - Sign with `buildSignature("inquiry", { ... })`.
   - On non-`00` response code → throw
     `PayoutProviderError({ kind: "client_error", code,
     message: <inquiry-response-message> })`.
   - On `00` response with `accountName !==
     merchant.payoutAccountHolderName`:
     throw `PayoutProviderError({ kind: "client_error", code:
     "name_mismatch" })`. Do **not** proceed to transfer.
   - Capture `disburseId` from the response.
5. **Transfer step** — POST `${apiBase}/transfer[sandbox]` with:
   - All inquiry fields plus `accountName` (use the name Duitku
     returned, not the one we stored — they matched per step 4),
     `custRefNumber = intent.id`, `disburseId` (from step 4),
     `signature` signed with `buildSignature("transfer", { ... })`.
   - Map the response per research §2.6:
     - `00` → `status: "COMPLETED"`, `completedAt = now`.
     - `80` → `status: "PROCESSING"` (H2H only; shouldn't occur on
       RTOL but map it anyway).
     - `68` / `TO` / `-100` → returns a `PENDING` receipt with a flag
       telling `PayoutService` to enqueue a reconcile job. **Task 09**
       owns this short-circuit; for this task, delegate to a method
       `handleAmbiguousResponseCode` that task 09 will implement.
     - `01` / `-510` / `-141` / `-148` / `-149` / `-192` / `-420` /
       `76` → `FAILED` terminal.
     - `-951` / `-952` / `-920` / `-191` / `-213` / `-930` / `-960`
       → throw `PayoutProviderError` with the appropriate `kind`
       (per research §2.6 mapping).
6. Return a `TPayoutReceipt` shaped identically to the Xendit
   adapter's output (same keys, same `status` enum values), with
   `providerPayoutId = disburseId`, `providerResponseCode =
   response.responseCode`, `providerResponseBody = <raw JSON>`.

## Rules (non-negotiable)

- **Always inquiry first, even though it costs a round-trip.** The
  holder-name check is the guardrail; skipping it to save latency is
  not an option.
- **`custRefNumber` MUST equal `intent.id`.** Duitku rejects
  duplicates with `-142` — this is our idempotency key, same one
  Xendit uses today.
- **Never log** the plaintext account number, `secretKey`, or the
  signature itself. Redact at the log boundary — task 13 tests this.
- **Compare `accountName` to `merchant.payoutAccountHolderName`
  case-sensitively and trimmed.** If you need to normalize more, add a
  small helper and document the rule; don't do ad-hoc
  `.replace()` chains inline.
- **No `if (providerName === …)` branches.** Everything in this method
  is Duitku-specific inside a Duitku-only adapter — that's the whole
  point of the port.
- **Do not retry the transfer on ambiguous codes.** Task 09 handles
  the short-circuit, but in this task make sure the placeholder
  `handleAmbiguousResponseCode` call returns (not falls through to a
  generic retry). See §2.6 retry rule — retransmitting `TO`/`68`/`-100`
  can double-disburse.

## Acceptance

- [ ] `triggerPayout` performs inquiry → transfer in sequence.
- [ ] Inquiry's `accountName` is compared to
      `merchant.payoutAccountHolderName`; mismatch throws a
      `client_error` and does not call transfer.
- [ ] `custRefNumber` on the transfer request equals `intent.id`.
- [ ] `bankCode` is resolved via `ProviderChannel` where
      `provider = 'duitku'`, never hardcoded.
- [ ] `TPayoutReceipt` shape is identical to the Xendit adapter's —
      same keys, same enum values; a `typeof` comparison test passes.
- [ ] `providerPayoutId` = Duitku `disburseId`;
      `providerResponseCode` populated; `providerResponseBody`
      captures the raw JSON.
- [ ] `response.responseCode ∈ { "TO", "68", "-100" }` reaches the
      `handleAmbiguousResponseCode` seam (body in task 09).
- [ ] No plaintext account number, secret, or signature appears in
      any logger call inside this method.

## Out of scope

- Response-code retry short-circuit body — task 09.
- `getStatus` reconcile — task 08.
- Sandbox e2e against `sandbox.duitku.com` — task 16.
- Unit tests — task 13.
