# Task 22 — Unit tests for `OnchainSettlementProvider.settle` — all §8 branches

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §8.2, §9 item 1

## Why this matters

The onchain adapter has 8+ distinct failure branches. Each must be
tested with a mocked `BlockchainVerificationService` to prove the
adapter maps every chain-level failure to the correct `failureCode`
and intent status. This is the primary correctness gate before staging.

## Scope

Create `test/unit/onchain-settlement-provider.spec.ts` (or co-located
`*.spec.ts` next to the provider):

**Table-driven test cases:**

| # | Scenario | Mock behavior | Expected |
|---|---|---|---|
| 1 | Happy path | Both phases pass | `SETTLED`, `OnchainSettlement` created |
| 2 | Wrong `payerInput.kind` | n/a | `SettlementRejectedError("PAYER_INPUT_WRONG_KIND")` |
| 3 | Idempotent replay (same intentId + txHash) | Existing row | Return prior receipt, no re-verification |
| 4 | `waitForTransactionReceipt` timeout | Phase A throws timeout | `status: "SETTLING"` (202) |
| 5 | Receipt status reverted | Phase A returns reverted receipt | `FAILED`, `failureCode = TX_REVERTED` |
| 6 | Sender mismatch | Phase A throws sender mismatch | `FAILED`, `failureCode = SENDER_MISMATCH` |
| 7 | Recipient mismatch | Phase A throws recipient mismatch | `FAILED`, `failureCode = RECIPIENT_MISMATCH` |
| 8 | `getMerchantPaymentByRef` returns zero | Phase B throws REF_NOT_ON_CHAIN | `FAILED`, `failureCode = REF_NOT_ON_CHAIN` |
| 9 | Contract data field mismatch | Phase B throws CONTRACT_DATA_MISMATCH | `FAILED`, `failureCode = CONTRACT_DATA_MISMATCH` |
| 10 | Different txHash for settled intent | Prior settlement exists with different hash | 409, `INTENT_ALREADY_SETTLED` |

**Mocking strategy:**
- Mock `BlockchainVerificationService` (both `verifyTxReceiptOnly` and
  `verifyMerchantPaymentInContract`).
- Mock `PrismaService` for DB reads/writes.
- Mock `ConfigService` for `ONCHAIN_MIN_CONFIRMATIONS`.

## Rules (non-negotiable)

- **Every branch in §8.2 has at least one test.** No untested paths.
- **Use the NestJS testing module** (`Test.createTestingModule`) for
  proper DI.
- **Table-driven** where possible — use `it.each` or `describe.each`.
- Tests must be runnable via `pnpm run test -- --testPathPattern=onchain-settlement`.

## Acceptance

- [ ] All 10 scenarios above have passing tests.
- [ ] `pnpm run test -- --testPathPattern=onchain-settlement` passes.
- [ ] No real network calls — all blockchain interaction mocked.

## Out of scope

- Integration / e2e tests (task 24).
- Nanopay adapter tests (existing — unchanged).
