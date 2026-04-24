# Task 20 — Add `sourceTokenId` to `CreateIntentDto` + quote-math widening

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.8

## Why this matters

Today intent creation is USDC-only (hardcoded). Multi-token support
requires the customer to specify which token they're paying with. The
FX rate resolution must widen from `USDC → IDR` to
`token.symbol → IDR`, and the token must pass the `isPaymentEnabled`
gate.

## Scope

**DTO change** — `src/pay/dto/create-intent.dto.ts`:

```ts
@IsString()
sourceTokenId: string;   // Token.id (ULID) from mobile picker
```

**Intent creation logic** — `IntentsService.createIntent`:

1. Resolve token: `prisma.token.findUniqueOrThrow({ where: { id: dto.sourceTokenId } })`.
2. Assert `token.isPaymentEnabled === true` — reject otherwise.
3. Resolve FX rate:
   ```ts
   const rate = await this.exchangeRateService.getLatest({
     fromCurrency: token.symbol,  // "USDC", "USDT", "IDRX", etc.
     toCurrency: dto.fiatCurrency,
     region: "ID",
   });
   ```
4. Compute `tokenAmountMinor` from `fiatAmountMinor / fxRate × markup`
   using the token's decimals (`token.decimals`).
5. Populate `PaymentIntent.sourceTokenId`, `PaymentIntent.fxFromCurrency = token.symbol`.
6. Populate `PaymentIntent.sourceTokenAddress` (if column exists) or
   derive from the token + chain combo for the quote commitment.

**Backward compat:** If `sourceTokenId` is not provided, fall back to
the default USDC token for the chain (existing behavior). This allows
mobile to roll out the picker incrementally.

## Rules (non-negotiable)

- **`isPaymentEnabled` gate.** Tokens not whitelisted → 400 error with
  a clear message.
- **Token decimals matter.** `tokenAmountMinor` must use
  `10 ** token.decimals`, not hardcoded `10 ** 6` (USDC).
- **`fxFromCurrency` from `token.symbol`**, not hardcoded `"USDC"`.
- **Backward-compatible.** Existing mobile that doesn't send
  `sourceTokenId` must still work (default to USDC).

## Acceptance

- [ ] `CreateIntentDto` has `sourceTokenId` (optional for backward compat).
- [ ] Token resolved and `isPaymentEnabled` checked.
- [ ] FX rate resolved using `token.symbol`.
- [ ] `tokenAmountMinor` computed with correct decimals.
- [ ] `PaymentIntent.sourceTokenId` and `fxFromCurrency` populated.
- [ ] Existing tests pass (default USDC path).
- [ ] `pnpm run build` passes.

## Out of scope

- Platform fee computation (task 21).
- Native token support (forward-compat preserved but not implemented).
- Token picker UX in mobile (§13 non-goal).
