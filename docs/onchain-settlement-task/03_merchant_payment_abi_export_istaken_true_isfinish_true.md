# Task 03 — Export merchant-payment ABI to `takumi-wallet-merchant.abi.ts`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.7 (ABI update paragraph)

## Why this matters

The onchain adapter uses viem's `readContract` to call
`getMerchantPaymentByRef`. viem needs a typed ABI array to generate
correct return types. Without a merchant-payment ABI file, the adapter
would need unsafe `any` casts or inline ABI fragments.

## Scope

- Create `src/blockchain-verification/abis/takumi-wallet-merchant.abi.ts`.
- Export a `const takumiWalletMerchantAbi = [...]` containing only the
  merchant-payment subset of the contract ABI:
  - `processMerchantPayment` (for reference / future `writeContract` if needed)
  - `getMerchantPaymentByRef` (used by `verifyMerchantPaymentInContract`)
  - `backendSigner` (used by boot-time assertion in task 14)
  - `platformFeeAccrued` (used by treasury reconciliation in task 28)
  - `MerchantPaymentProcessed` event
  - `PlatformFeesSwept` event
  - `BackendSignerRotated` event
- Source the ABI from the compiled contract artifact (task 01 output).
- The existing `takumi-wallet.abi.ts` is **not modified** — purchase
  flow continues to import from there.

## Rules (non-negotiable)

- **`as const` export** — viem requires `as const` for type inference.
- **Do not duplicate the full contract ABI.** Only merchant-payment
  functions + events. This keeps imports clean and avoids the two files
  drifting if the purchase side changes.
- File must compile with `pnpm run build` — no missing types.

## Acceptance

- [ ] `src/blockchain-verification/abis/takumi-wallet-merchant.abi.ts`
      exists and exports `takumiWalletMerchantAbi`.
- [ ] ABI includes `getMerchantPaymentByRef`, `processMerchantPayment`,
      `backendSigner`, `platformFeeAccrued`, and all three events.
- [ ] `pnpm run build` passes.
- [ ] `takumi-wallet.abi.ts` is unchanged.

## Out of scope

- Using the ABI in adapter code (tasks 17, 18).
- Solana ABI equivalent (out of scope per spec).
