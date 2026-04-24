# Task 13 — `QuoteSignerService` — EIP-712 `QuoteCommitment` signing

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.7 (backend-side signing paragraph)

## Why this matters

The contract's `processMerchantPayment` requires a backend-signed
EIP-712 quote to prevent griefing (arbitrary `refId` stuffing). This
service produces the signature that mobile passes into the contract
call. Without it, the onchain rail is unusable — every customer tx
would revert with `BAD_QUOTE`.

## Scope

Create `src/pay/quote-signer.service.ts`:

- `signQuote(commitment: QuoteCommitment): Promise<Hex>` — signs the
  commitment struct using viem's `signTypedData` with the
  `QUOTE_SIGNER_PRIVATE_KEY` (or `ADMIN_WALLET_PRIVATE_KEY` fallback).

- EIP-712 domain:
  ```ts
  {
    name: configService.get("QUOTE_SIGNATURE_DOMAIN_NAME", "TakumiPay"),
    version: configService.get("QUOTE_SIGNATURE_DOMAIN_VERSION", "1"),
    chainId,
    verifyingContract: contractAddress,
  }
  ```

- `QuoteCommitment` type matching the contract struct:
  ```ts
  {
    refId: string;
    merchantId: string;
    tokenAddress: Address;
    amount: bigint;
    platformFeeAmount: bigint;
    fiatAmountMinor: bigint;
    fiatCurrency: string;   // "IDR"
    exchangeRateId: bigint;
    expiresAt: bigint;       // UNIX seconds
  }
  ```

- The service exposes **only** `signQuote()`. The raw private key is
  not readable by other services (encapsulation).

- Rate limiting is NOT this service's concern — it inherits the rate
  limit from `IntentsService.createIntent` (`BOOKING_RATE_LIMIT_*`).

## Rules (non-negotiable)

- **EIP-712 typehash** must exactly match `QUOTE_TYPEHASH` in the
  contract (task 01). Field names, types, and order must be identical.
- **Domain separator** must include `chainId` + `verifyingContract` —
  this is what prevents cross-chain replay (invariant I-5 from §12.2).
- **Key encapsulation.** The service reads the private key from env at
  construction time and never exposes it. Other services interact via
  `signQuote()` only.
- **Per-chain signing.** The domain separator changes per chain (different
  `chainId`, potentially different `verifyingContract`). The service
  must accept chain context as a parameter.

## Acceptance

- [ ] `QuoteSignerService` exports `signQuote(commitment, chainContext)`.
- [ ] Signature is recoverable to the expected signer address using
      viem's `recoverTypedDataAddress`.
- [ ] Unit test: sign → recover → assert address matches.
- [ ] `pnpm run build` passes.
- [ ] Private key is not accessible outside the service.

## Out of scope

- Boot-time signer assertion (task 14).
- Wiring into intent creation response (task 15).
- Contract-side verification (task 01).
