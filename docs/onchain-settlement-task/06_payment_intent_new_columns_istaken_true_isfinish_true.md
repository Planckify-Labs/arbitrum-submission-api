# Task 06 — Add `sourceTokenId`, `platformFeeAmountMinor`, `merchantBackingAmountMinor`, `platformFeeBpsSnapshot`, `quoteSignature`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §5.3

## Why this matters

These columns support multi-token payment, platform fee tracking, and
EIP-712 quote persistence. Without them, the quote signer (task 13) and
onchain adapter (task 18) have nowhere to store their outputs, and
treasury reconciliation (task 28) can't reconstruct fee splits.

## Scope

Add to `PaymentIntent` in `prisma/schema.prisma`:

- `sourceTokenId String?` — FK to `Token.id`. Identifies the token the
  customer pays with. Nullable for backward compat with existing intents.
  Add the relation: `sourceToken Token? @relation(fields: [sourceTokenId], references: [id])`.
- `platformFeeAmountMinor BigInt?` — portion of `tokenAmountMinor` that
  is platform revenue. Matches `QuoteCommitment.platformFeeAmount`.
- `merchantBackingAmountMinor BigInt?` — convenience =
  `tokenAmountMinor - platformFeeAmountMinor`. Indexed for treasury
  reconciliation.
- `platformFeeBpsSnapshot Int?` — BPS rate used at quote time.
  Snapshotted so post-rate-change reconciliation reproduces the quote.
- `quoteSignature Bytes?` — EIP-712 signature returned to mobile.
  Persisted for re-verification against historical signer.

Also: ensure `fxFromCurrency` exists (it does per spec — verify and
note that it should be populated from `token.symbol` instead of
hardcoded `"USDC"` — that logic change is task 20).

## Rules (non-negotiable)

- **All new columns are nullable.** Existing intents must not break.
- **No application-code changes writing these columns.** This is
  schema-only. Tasks 13, 15, 20, 21 populate them.
- **FK to `Token`** via `sourceTokenId` — not a hypertable, so FK is
  safe.

## Acceptance

- [ ] `prisma/schema.prisma` has all five new columns on `PaymentIntent`.
- [ ] `Token` model has inverse relation (`paymentIntents PaymentIntent[]`).
- [ ] `pnpm prisma migrate dev` applies cleanly.
- [ ] `bash scripts/lint-migrations.sh` passes.
- [ ] `pnpm prisma generate` succeeds.
- [ ] Existing tests pass (no application code changed).

## Out of scope

- Populating these columns from application code (tasks 13, 15, 20, 21).
- `Token.isPaymentEnabled` / `Token.platformFeeBps` (task 07).
