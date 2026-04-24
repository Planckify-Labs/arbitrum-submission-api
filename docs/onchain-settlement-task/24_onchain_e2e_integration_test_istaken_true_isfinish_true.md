# Task 24 — E2E: `POST /v1/pay/intents/:id/onchain` → Xendit stub → `PAID_OUT`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §9 items 2–3

## Why this matters

The unit tests (task 22) mock the blockchain. This e2e test proves the
full round-trip works with real (testnet) or realistically-stubbed chain
interaction, through settlement, payout trigger, and disbursement
webhook — the complete happy path from customer payment to merchant
IDR credit.

## Scope

Create `test/e2e/onchain-settlement.e2e-spec.ts`. Mirror the structure
of the existing `test/provider-agnostic-payout-migration.e2e-spec.ts`.

**Happy-path flow:**

1. Seed a merchant + user + token (USDC, `isPaymentEnabled = true`) +
   blockchain row (with `takumiWalletContract`, `quoteSignerAddress`,
   `minConfirmations`).
2. `POST /v1/pay/intents` → create intent with `sourceTokenId`,
   `path = "direct_arc"`.
3. Assert response includes `quoteCommitment` + `quoteSignature`.
4. Stub or fork-testnet: simulate a successful
   `processMerchantPayment` transaction.
5. `POST /v1/pay/intents/:id/onchain` with the txHash + chainId.
6. Assert intent status → `SETTLED`.
7. Assert `OnchainSettlement` row created.
8. Assert `PayoutService.trigger` was called (or mock Xendit webhook).
9. Fire Xendit sandbox webhook → intent status → `PAID_OUT`.

**Fork-testnet variant** (if testnet contract from task 02 is available):
- Use Arc testnet with a real `processMerchantPayment` call.
- Submit the real txHash.
- Backend verifies against the real contract.

**Stub variant** (if contract not yet deployed):
- Mock `BlockchainVerificationService` at the integration boundary.
- Still exercises the full API → orchestrator → adapter → DB path.

## Rules (non-negotiable)

- **Full stack.** Use `@nestjs/testing` supertest — real HTTP, real DB,
  real DI. Only blockchain calls are stubbed/testnet.
- **Cleanup after.** Each test cleans up its seed data.
- **Existing tests unaffected.** This test file is additive.
- **Both payout providers.** Run the disbursement step with at least one
  provider (Xendit or Duitku sandbox).

## Acceptance

- [ ] E2E test passes end-to-end: intent → onchain settlement →
      payout → `PAID_OUT`.
- [ ] `pnpm run test:e2e -- --testPathPattern=onchain-settlement` passes.
- [ ] `OnchainSettlement` and `ProviderPayout` rows verified.

## Out of scope

- Nanopay e2e (existing — unchanged).
- Fork-testnet CI pipeline setup (manual for now).
