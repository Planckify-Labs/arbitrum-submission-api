# Task 21 — Platform fee computation at quote time (§4.7a)

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.7a

## Why this matters

The platform fee is an explicit, labeled portion of the on-chain
`amount`, computed at quote time. It must be correct for three reasons:
(1) the contract enforces `platformFeeAmount <= amount`, (2) the
on-chain `platformFeeAccrued` counter depends on it, and (3) treasury
reconciliation uses it to separate platform revenue from merchant
backing.

## Scope

In `IntentsService.createIntent`, after resolving the token and FX rate
(task 20):

```ts
const platformBps = token.platformFeeBps; // 0..1000

// merchant_backing = fiatAmountMinor converted at locked rate+markup
const merchantBacking = mulDiv(
  dto.fiatAmountMinor,
  10n ** BigInt(token.decimals),
  rate.scaledRate
) * (10_000n + rate.markupBps) / 10_000n;

// total = merchantBacking / (1 - platformBps/10_000)
const totalAmount = merchantBacking * 10_000n / BigInt(10_000 - platformBps);
const platformFeeAmount = totalAmount - merchantBacking;
```

Persist on `PaymentIntent`:
- `tokenAmountMinor = totalAmount`
- `platformFeeAmountMinor = platformFeeAmount`
- `merchantBackingAmountMinor = merchantBacking`
- `platformFeeBpsSnapshot = platformBps`

Include `platformFeeAmount` in the `QuoteCommitment` struct passed to
`QuoteSignerService.signQuote` (task 13).

**Zero-fee case:** When `platformFeeBps = 0`:
- `platformFeeAmount = 0`
- `totalAmount = merchantBacking`
- All fields still populated (no special-casing).

## Rules (non-negotiable)

- **`platformFeeAmount + merchantBacking === totalAmount`** — enforce
  as an assertion in the code. This is invariant (1) from §4.7a.
- **`platformFeeBps` valid range: 0–1000.** Reject values outside this
  range at intent creation time.
- **bigint arithmetic throughout.** No floating point. Use `BigInt` for
  all fee/amount math.
- **`mulDiv` or equivalent** — avoid intermediate overflow. For
  `Decimal(36,18)` rates, scale appropriately.

## Acceptance

- [ ] `tokenAmountMinor` includes platform fee.
- [ ] `platformFeeAmountMinor` is correctly computed.
- [ ] `merchantBackingAmountMinor = tokenAmountMinor - platformFeeAmountMinor`.
- [ ] `platformFeeBpsSnapshot` captures the rate used.
- [ ] Zero-fee case works (bps = 0 → fee = 0).
- [ ] Unit test: known inputs → expected fee split.
- [ ] Assertion: `platformFeeAmount + merchantBacking === totalAmount`.
- [ ] `pnpm run build` and `pnpm run test` pass.

## Out of scope

- Per-merchant fee override (`MerchantTokenFeeOverride` table — not in v1).
- On-chain fee enforcement (task 01 — contract handles `FEE_EXCEEDS_AMOUNT`).
- Treasury sweep (task 28).
