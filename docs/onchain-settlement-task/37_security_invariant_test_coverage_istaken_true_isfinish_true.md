# Task 37 — Test coverage for all 14 security invariants + attack-tree leaves

**Status:** Not taken
**Owner:** Eng
**Spec reference:** `onchain-merchant-settlement-spec.md` §12.2, §12.3, §12.7 items 8–9

## Why this matters

The pre-launch checklist requires that every security invariant (I-1
through I-14) and every attack-tree leaf (A1 through A7) has at least
one test. This is the audit-readiness gate — without it, the external
auditor has no evidence that the stated security properties hold.

## Scope

Create or extend test files to cover:

### Security invariants (§12.2)

| Invariant | Test location | What to test |
|---|---|---|
| I-1: No funds without quote | Solidity test | `processMerchantPayment` with invalid sig → revert `BAD_QUOTE` |
| I-2: Quote immutable | Solidity test | Modify one field → `BAD_QUOTE` |
| I-3: No replay | Solidity test | Same refId twice → `REF_CONSUMED` |
| I-4: Stale quote rejected | Solidity test | `block.timestamp > expiresAt` → `QUOTE_EXPIRED` |
| I-5: Cross-chain replay impossible | Solidity test | Sign for chain A, verify on chain B → `BAD_QUOTE` |
| I-6: No PII on-chain | Code review | Assert no PII fields in `QuoteCommitment` or `MerchantPayment` structs |
| I-7: Payer = msg.sender | Solidity test | Verify `MerchantPayment.payer == msg.sender` |
| I-8: No fabricated settlement | Backend unit test | Mock `getMerchantPaymentByRef` returning zero → settlement fails |
| I-9: Disbursement bounded by settlement | Backend unit test | Assert `kickPayout` only called after `SETTLED` |
| I-10: Custody recoverable | Solidity test | `sweep` withdraws funds |
| I-11: Front-running self-defeating | Solidity test | Different `msg.sender` pays from own balance |
| I-12: Webhook auth | Backend test | Existing webhook verification tests (verify they exist) |
| I-13: Fee withdrawal bounded | Solidity test | `sweepPlatformFees` exceeding `platformFeeAccrued` → revert |
| I-14: Per-chain finality enforced | Backend unit test | `minConfirmations` resolution chain tested |

### Attack-tree leaves (§12.3)

| Attack | Test | Mechanism |
|---|---|---|
| A1 — Fake settlement | Backend test | Forge event → blocked by I-8 test |
| A2 — Steal customer funds | Solidity tests | Front-run, replay, modify → blocked by I-11, I-3, I-2 |
| A3 — Pay less than quoted | Solidity test | Reduce amount → `BAD_QUOTE` |
| A4 — Grief/DoS | Solidity test | Fabricated call → revert (gas on attacker) |
| A5 — Cross-chain confusion | Solidity test | Covered by I-5 test |
| A6 — PII exfiltration | Code review | Covered by I-6 review |
| A7 — Permanent fund lock | Solidity test | Covered by I-10 test |

### Deliverable

A **test index document** (`docs/security-test-index.md`) mapping each
invariant and attack-tree leaf to its test file + test name. This is
what the auditor receives.

## Rules (non-negotiable)

- **Every invariant has ≥ 1 test.** No gaps.
- **Every attack-tree leaf has ≥ 1 test.** No gaps.
- **Test index is the audit artifact.** It must be accurate and up-to-date.
- Many of these tests will already exist from tasks 01, 22, 23. This
  task audits coverage and fills gaps — it does NOT rewrite existing tests.

## Acceptance

- [ ] All 14 invariants have at least one test (Solidity or backend).
- [ ] All attack-tree leaves have at least one test.
- [ ] `docs/security-test-index.md` maps each item to test file + name.
- [ ] All tests pass.

## Out of scope

- External Solidity audit (ops coordination — §12.7 item 1).
- Tabletop drill (ops — §12.7 item 15).
- DR rebuild drill (ops — §12.7 item 19).
- Bug bounty program (ops — §12.7 item 20).
