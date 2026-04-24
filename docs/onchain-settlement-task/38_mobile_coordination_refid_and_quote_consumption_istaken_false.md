# Task 38 — Mobile coordination: refId = intentId + quote consumption documentation

**Status:** Not taken
**Owner:** Eng (API + Mobile)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.5, §4.7 (mobile passes quote), §4.9 (re-quote flow)

## Why this matters

The onchain rail requires mobile to do three things it doesn't do today:
(1) pass `intent.id` as the contract's `refId`, (2) pass the
`quoteCommitment + quoteSignature` from the intent response into
`processMerchantPayment`, and (3) handle the re-quote flow on expiry.
Without clear documentation, the mobile team will either guess wrong or
block on API team availability.

## Scope

Create `docs/mobile-onchain-integration.md` covering:

### 1. Contract call construction

```
processMerchantPayment(
  QuoteCommitment {
    refId:             intent.id,           // from POST /v1/pay/intents response
    merchantId:        intent.merchantId,
    tokenAddress:      quoteCommitment.tokenAddress,
    amount:            BigInt(quoteCommitment.amount),
    platformFeeAmount: BigInt(quoteCommitment.platformFeeAmount),
    fiatAmountMinor:   BigInt(quoteCommitment.fiatAmountMinor),
    fiatCurrency:      quoteCommitment.fiatCurrency,
    exchangeRateId:    BigInt(quoteCommitment.exchangeRateId),
    expiresAt:         BigInt(quoteCommitment.expiresAt),
  },
  quoteSignature       // hex string from POST /v1/pay/intents response
)
```

### 2. ERC-20 approval flow

Before calling `processMerchantPayment`, mobile must ensure the
TakumiWallet contract has sufficient ERC-20 allowance from the user:
- Check `IERC20.allowance(user, contractAddress)`.
- If insufficient, prompt `IERC20.approve(contractAddress, amount)`.
- Then call `processMerchantPayment`.

### 3. Re-quote flow (§4.9)

- Show countdown: `expiresAt - 60s` safety margin.
- On countdown expiry: auto-fire `POST /v1/pay/intents` with a **new**
  `Idempotency-Key`.
- Cache `merchantId` from QR — do not re-scan.
- Display new quote to user.

### 4. Error handling

| Contract revert | Mobile action |
|---|---|
| `QUOTE_EXPIRED` | Auto re-quote |
| `REF_CONSUMED` | Auto re-quote + log to analytics |
| `BAD_QUOTE` | Show generic error + log to analytics |
| `NATIVE_AMOUNT_MISMATCH` | Should not happen (client validation) |
| ERC-20 `transferFrom` revert | Show "insufficient balance/allowance" |

### 5. Post-payment submission

After tx confirms: `POST /v1/pay/intents/:id/onchain { txHash, chainId }`.

### 6. Polling

Poll `GET /v1/pay/intents/:id` for status transitions:
`QUOTED → SIGNED → SETTLED → PAID_OUT`.

## Rules (non-negotiable)

- **`refId = intent.id`** — this is non-negotiable. Mobile must NOT
  generate its own refId.
- **`quoteCommitment` and `quoteSignature` must be passed verbatim**
  from the API response to the contract call. No field renaming or
  recomputation on mobile.
- **New `Idempotency-Key` per re-quote** — reusing the old key returns
  the stale intent.

## Acceptance

- [ ] `docs/mobile-onchain-integration.md` created and reviewed by
      mobile team.
- [ ] Covers contract call construction, approval flow, re-quote,
      error handling, and post-payment submission.
- [ ] Mobile team acknowledges the doc (comment/sign-off).

## Out of scope

- Mobile implementation (mobile team scope).
- Solana mobile integration (out of scope per spec).
- Token picker UX (§13 non-goal).
