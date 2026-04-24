# Task 33 — Fork-testnet: real `processMerchantPayment` → backend verification

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §9 item 3

## Why this matters

Unit tests mock the chain. E2e tests (task 24) may stub the contract
call. This test fires a **real** `processMerchantPayment` on Arc testnet
and feeds the real txHash to the backend — proving the full ABI, EIP-712
signature, contract state, and viem `readContract` round-trip work
against an actual deployment. This catches ABI/struct mismatches that
mocks can't.

## Scope

Create `test/fork-testnet/onchain-settlement-fork.spec.ts` (or similar):

1. **Prerequisites:**
   - Arc testnet contract deployed (task 02).
   - Testnet `QUOTE_SIGNER_PRIVATE_KEY` configured.
   - Testnet wallet funded with gas + test tokens.

2. **Test flow:**
   - Sign a `QuoteCommitment` using `QuoteSignerService` (real signing,
     not mocked).
   - Call `processMerchantPayment(quote, signature)` on the testnet
     contract using viem `writeContract`.
   - Wait for confirmation.
   - Submit txHash via `POST /v1/pay/intents/:id/onchain`.
   - Assert `OnchainSettlement` row created with `verifiedAt` set.
   - Assert `getMerchantPaymentByRef(refId)` returns matching struct.

3. **Negative test:**
   - Submit a txHash where the contract call used a wrong `refId` →
     backend returns `REF_NOT_ON_CHAIN` or `CONTRACT_DATA_MISMATCH`.

4. **Environment gating:**
   - Test should only run when `ARC_TESTNET_RPC_URL` is set.
   - Skip in CI unless testnet credentials are available.
   - Add a `@jest.skip` or env-conditional guard.

## Rules (non-negotiable)

- **Real chain interaction.** No mocking of viem or contract calls in
  this test.
- **Testnet only.** Never mainnet. Guard with env checks.
- **Idempotent.** Each test run uses a unique `refId` (ULID). No
  cleanup required on-chain (consumed refs are permanent, but don't
  affect other tests).
- **Timeout.** Set Jest timeout to ≥ 120s (confirmation wait + API call).

## Acceptance

- [ ] Test fires real `processMerchantPayment` on Arc testnet.
- [ ] Backend verifies the real txHash successfully.
- [ ] `OnchainSettlement` row matches the on-chain `MerchantPayment`.
- [ ] Negative test returns expected failure code.
- [ ] Test is skippable when testnet credentials are unavailable.

## Out of scope

- Mainnet testing.
- CI pipeline testnet credential management.
- Solana fork testing (out of scope per spec).
