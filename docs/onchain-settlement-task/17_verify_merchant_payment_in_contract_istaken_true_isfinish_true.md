# Task 17 — Add `BlockchainVerificationService.verifyMerchantPaymentInContract`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.4 (Phase B — merchant-payment-shaped contract verification)

## Why this matters

The existing `verifyTransactionInContract` calls `getTransactionByRef`
which returns the purchase-shaped `Transaction` struct. Merchant payments
use `getMerchantPaymentByRef` which returns the `MerchantPayment` struct
with different fields (`merchantId`, `platformFeeAmount`, etc.). This
method is the merchant-payment Phase B — it reads the contract and
compares against the DB-stored intent expectations.

## Scope

Add to `BlockchainVerificationService`:

```ts
async verifyMerchantPaymentInContract(args: {
  contractAddress: string;
  chainId: number;
  refId: string;
  expectedPayer: string;
  expectedMerchantId: string;
  expectedTokenAddress: string;
  expectedAmount: string;          // bigint as string
  expectedFiatAmountMinor: bigint;
  expectedFiatCurrency: string;
  expectedExchangeRateId: bigint;
}): Promise<MerchantPayment>
```

Implementation:

1. Get the viem client for `chainId` (existing `getClientForChain`).
2. `readContract({ abi: takumiWalletMerchantAbi, functionName: "getMerchantPaymentByRef", args: [refId] })`.
3. Assert the returned struct is non-zero (zero = `refId` not found on-chain → `REF_NOT_ON_CHAIN`).
4. Compare each field against expectations:
   - `payer` via `addressesEqual` (existing helper)
   - `merchantId` strict equal
   - `tokenAddress` via `addressesEqual` (with native-token sentinel)
   - `amount.toString() === expectedAmount` (string-compare of bigint)
   - `fiatAmountMinor`, `fiatCurrency`, `exchangeRateId` strict equal
5. Any mismatch → throw `CONTRACT_DATA_MISMATCH` with a log line
   identifying the mismatched field.

## Rules (non-negotiable)

- **Import `takumiWalletMerchantAbi`** from task 03's ABI file.
- **String-compare for amount** — same precision-safe approach as the
  existing purchase verifier (line 402).
- **`addressesEqual`** — use the existing helper for address comparison
  (lowercased, handles checksummed vs. non-checksummed).
- **Zero-struct detection** — check `payer === address(0)` as the
  sentinel for "not found."

## Acceptance

- [ ] `verifyMerchantPaymentInContract` is a public method on
      `BlockchainVerificationService`.
- [ ] Imports from `takumi-wallet-merchant.abi.ts`.
- [ ] Throws `REF_NOT_ON_CHAIN` for zero-value struct.
- [ ] Throws `CONTRACT_DATA_MISMATCH` with field name for any mismatch.
- [ ] Unit test with mocked `readContract`: matching → OK, each field
      mismatch → correct error.
- [ ] `pnpm run build` passes.

## Out of scope

- Calling this method from the adapter (task 18).
- `verifyTxReceiptOnly` (task 16).
