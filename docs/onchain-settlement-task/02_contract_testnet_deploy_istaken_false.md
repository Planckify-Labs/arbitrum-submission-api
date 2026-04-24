# Task 02 — Deploy extended contract to Arc testnet + set `backendSigner`

**Status:** Not taken
**Owner:** Eng (Solidity / Ops)
**Spec reference:** `onchain-merchant-settlement-spec.md` §10 Phase 0

## Why this matters

The onchain adapter (task 18) needs a live contract to call
`getMerchantPaymentByRef` against during e2e and fork-testnet tests.
Without a testnet deployment, Phase 4 is blocked on stubs.

## Scope

- Deploy the extended TakumiWallet contract (from task 01) to the **Arc
  testnet** using the existing deployment tooling.
- Set `backendSigner` to a dedicated testnet signer address (derived
  from a testnet-only `QUOTE_SIGNER_PRIVATE_KEY`).
- Record the deployed contract address and signer address in the
  `Blockchain` table for the Arc testnet row (columns added in task 08).
- Verify `processMerchantPayment` + `getMerchantPaymentByRef` work with
  a manual test transaction.

## Rules (non-negotiable)

- **Testnet key only.** The `QUOTE_SIGNER_PRIVATE_KEY` used for testnet
  must NOT be the same as the production admin key.
- **Existing purchase functions** must remain callable on the redeployed
  contract. Run the existing purchase-flow seed/test against the new
  deployment.
- If the chain uses a proxy pattern, follow the existing upgrade process
  rather than deploying a standalone contract.

## Acceptance

- [ ] Contract deployed to Arc testnet with a known address.
- [ ] `backendSigner` set and confirmed via `contract.backendSigner()`.
- [ ] Manual `processMerchantPayment` call succeeds with a valid signed
      quote.
- [ ] `getMerchantPaymentByRef` returns the persisted payment struct.
- [ ] Existing `payForProduct` / `getTransactionByRef` still work.
- [ ] Deployed address documented (env file, seed script, or DB row).

## Out of scope

- ABI export (task 03).
- Mainnet deployment (Phase 6+).
- Multi-sig owner migration (pre-launch checklist §12.7 item 4).
