# Task 16 — Extract `BlockchainVerificationService.verifyTxReceiptOnly` from `verifyTransaction`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.4 (refactor note)

## Why this matters

`verifyTransaction` today bundles Phase A (tx-level: receipt wait,
status, chainId, sender, recipient) and Phase B (`getTransactionByRef`
— purchase-shaped contract read) in one method. The onchain merchant
adapter needs Phase A only — it runs its own merchant-shaped Phase B
(task 17). This refactor makes Phase A independently callable without
duplicating 80 lines of battle-tested verification logic.

## Scope

In `src/blockchain-verification/blockchain-verification.service.ts`:

1. **Extract** lines 185-247 (Phase A) into a new public method:
   ```ts
   async verifyTxReceiptOnly(args: {
     transactionHash: string;
     expectedSender: string;
     expectedRecipient: string;
     expectedChainId: number;
     minimumConfirmations?: number;
   }): Promise<{ receipt: TransactionReceipt; transaction: Transaction }>
   ```

2. **Refactor** the existing `verifyTransaction` method to call
   `verifyTxReceiptOnly` internally, then proceed to Phase B
   (`verifyTransactionInContract`). This is a thin wrapper — existing
   callers (`PurchaseProcessor`) see no behavior change.

3. The return type of `verifyTxReceiptOnly` should include both the
   receipt and the raw transaction (the adapter needs `transaction.from`
   for sender verification).

## Rules (non-negotiable)

- **Backward-compatible.** `verifyTransaction` must produce identical
  behavior to before the refactor. `PurchaseProcessor` is not modified.
- **No new logic.** `verifyTxReceiptOnly` is a mechanical extraction —
  same checks, same error messages, same confirmation logic.
- **Tests must pass.** All existing blockchain verification tests must
  pass without modification.

## Acceptance

- [ ] `verifyTxReceiptOnly` is a public method on
      `BlockchainVerificationService`.
- [ ] `verifyTransaction` delegates to `verifyTxReceiptOnly` + continues
      to Phase B.
- [ ] All existing blockchain verification and purchase processor tests
      pass unchanged.
- [ ] `pnpm run build` passes.

## Out of scope

- `verifyMerchantPaymentInContract` (task 17).
- Using `verifyTxReceiptOnly` in the onchain adapter (task 18).
