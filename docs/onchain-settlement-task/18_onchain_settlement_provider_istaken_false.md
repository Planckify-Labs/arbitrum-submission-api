# Task 18 — `OnchainSettlementProvider` adapter implementation

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.4

## Why this matters

This is the core adapter that proves customer payment via the onchain
verification pipeline. It replaces the stub registered in task 12 with
a real implementation that calls `verifyTxReceiptOnly` (task 16) +
`verifyMerchantPaymentInContract` (task 17), persists an
`OnchainSettlement` row, and flips the intent to `SETTLED`.

## Scope

Create `src/pay/settlement/providers/onchain.settlement.provider.ts`:

```ts
@Injectable()
export class OnchainSettlementProvider implements IPaymentSettlementProvider {
  readonly key = "onchain";

  async settle({ intent, payerInput }: SettleArgs): Promise<SettleReceipt> {
    // 1. Assert payerInput.kind === "txHash"
    // 2. Idempotency: (intentId, txHash) → return prior row
    // 3. Resolve chain config from Blockchain table
    // 4. Resolve payer wallet address from User table
    // 5. Phase A: verifyTxReceiptOnly (12+ confirmations, sender, recipient)
    // 6. Phase B: verifyMerchantPaymentInContract (contract state matches intent)
    // 7. Prisma $transaction: create OnchainSettlement + update intent to SETTLED
    // 8. Return SettleReceipt
  }

  private minConfirmations(chain): number {
    // chain.minConfirmations ?? env ONCHAIN_MIN_CONFIRMATIONS ?? env MIN_CONFIRMATIONS ?? 12
  }
}
```

**Error mapping** (§8.2):

| Condition | Behavior |
|---|---|
| `waitForTransactionReceipt` timeout | Return `status: "SETTLING"` (202) |
| Receipt `reverted` | `FAILED` — `TX_REVERTED` |
| `from != intent.payer` | `FAILED` — `SENDER_MISMATCH` |
| `to != chain.takumiWalletContract` | `FAILED` — `RECIPIENT_MISMATCH` |
| `getMerchantPaymentByRef` returns zero | `FAILED` — `REF_NOT_ON_CHAIN` |
| Field mismatch on struct | `FAILED` — `CONTRACT_DATA_MISMATCH` |
| Same `(intentId, txHash)` replay | 200 — return prior row |
| Different txHash for already-SETTLED intent | 409 — `INTENT_ALREADY_SETTLED` |

## Rules (non-negotiable)

- **Idempotency first.** Check for existing `OnchainSettlement` row
  before doing any verification work.
- **Atomic DB write.** `OnchainSettlement.create` + `PaymentIntent.update`
  in a single Prisma `$transaction`.
- **Contract address comes from `Blockchain.takumiWalletContract`**, not
  from env or client input.
- **`minConfirmations`** follows the precedence chain from §4.4.
- Do NOT call `kickPayout` — that's the orchestrator's job (task 11).

## Acceptance

- [ ] Implements `IPaymentSettlementProvider` with `key = "onchain"`.
- [ ] All error paths from §8.2 are handled with correct failure codes.
- [ ] Idempotent replay returns prior row.
- [ ] 409 on different txHash for settled intent.
- [ ] `OnchainSettlement` row is persisted with all fields.
- [ ] `PaymentIntent.status` flipped to `SETTLED` atomically.
- [ ] `pnpm run build` passes.

## Out of scope

- `verifyTxReceiptOnly` implementation (task 16).
- `verifyMerchantPaymentInContract` implementation (task 17).
- Controller endpoint (task 19).
- `kickPayout` (orchestrator — task 11).
