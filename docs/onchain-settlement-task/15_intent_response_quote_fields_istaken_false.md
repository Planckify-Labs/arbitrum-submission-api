# Task 15 — Add `quoteCommitment` + `quoteSignature` to intent creation response

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.7 (PaymentIntentResponseDto paragraph)

## Why this matters

Mobile needs the signed quote commitment to pass into the contract's
`processMerchantPayment`. The intent creation response is the natural
delivery point — mobile gets the intent + quote + signature in one
round-trip, no extra API call needed.

## Scope

- After `PaymentIntent` is persisted in `IntentsService.createIntent`,
  call `QuoteSignerService.signQuote(commitment, chainContext)` to
  produce the EIP-712 signature.
- Persist `quoteSignature` on the `PaymentIntent` row (column from
  task 06).
- Add to the response DTO:
  ```ts
  quoteSignature: `0x${string}`;
  quoteCommitment: {
    refId: string;
    merchantId: string;
    tokenAddress: string;
    amount: string;          // bigint as string
    platformFeeAmount: string;
    fiatAmountMinor: string;
    fiatCurrency: string;
    exchangeRateId: string;
    expiresAt: number;       // UNIX seconds
  };
  ```
- For `path = nanopay`, these fields are **still populated** (harmless
  additive change — mobile ignores them). This keeps the response shape
  uniform.
- `expiresAt` derivation per §4.9:
  - `direct_arc`: `nowSec + QUOTE_TTL_DIRECT_ARC_SECONDS` (default 900).
  - `nanopay`: existing `nanopayValidBefore + 60`.

## Rules (non-negotiable)

- **Always sign.** Even for nanopay intents. The cost is one ECDSA
  signature per intent creation — negligible.
- **bigint fields serialized as strings** on the wire. Mobile parses
  them back to `BigInt` for the contract call.
- **`expiresAt` must be persisted** on `PaymentIntent.expiresAt` — the
  column already exists per spec.
- Do not break existing nanopay response consumers. New fields are
  additive.

## Acceptance

- [ ] `POST /v1/pay/intents` response includes `quoteCommitment` and
      `quoteSignature`.
- [ ] `PaymentIntent.quoteSignature` column is populated.
- [ ] `PaymentIntent.expiresAt` is set per-rail TTL rule.
- [ ] Existing nanopay intent creation tests pass with additive fields.
- [ ] `pnpm run build` passes.

## Out of scope

- Mobile consuming these fields (mobile-side task, out of API scope).
- Contract-side quote verification (task 01).
