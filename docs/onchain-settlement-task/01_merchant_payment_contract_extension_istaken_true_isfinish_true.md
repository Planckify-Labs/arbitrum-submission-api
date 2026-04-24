# Task 01 — Solidity: `MerchantPayment` struct + `processMerchantPayment` + EIP-712

**Status:** Not taken
**Owner:** Eng (Solidity)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.6, §4.7

## Why this matters

The existing TakumiWallet contract only handles user-purchase custody via
`payForProduct` / `getTransactionByRef`. Merchant payments need a
dedicated domain — new struct, new storage, new functions, new events —
so purchase and merchant flows don't pollute each other's semantics or
on-chain events. This is the longest-lead item in the entire rollout.

## Scope

Extend the deployed `TakumiWallet` contract with:

1. **`QuoteCommitment` struct** — the EIP-712 typed-data that the backend
   signs at quote time: `refId`, `merchantId`, `tokenAddress`, `amount`,
   `platformFeeAmount`, `fiatAmountMinor`, `fiatCurrency`,
   `exchangeRateId`, `expiresAt`.

2. **`MerchantPayment` struct** — on-chain settlement record: `payer`
   (from `msg.sender`), `tokenAddress`, `merchantId`, `refId`, `amount`,
   `platformFeeAmount`, `fiatAmountMinor`, `fiatCurrency`,
   `exchangeRateId`, `timestamp`.

3. **State additions:**
   - `address public backendSigner`
   - `mapping(bytes32 => bool) private _consumedRefs`
   - `mapping(bytes32 => MerchantPayment) private _payments`
   - `mapping(address => uint256) public platformFeeAccrued`

4. **`processMerchantPayment(QuoteCommitment, backendSignature)`** —
   entry point. Checks: `QUOTE_EXPIRED`, `REF_CONSUMED`, `BAD_QUOTE`
   (EIP-712 recover), `FEE_EXCEEDS_AMOUNT`, custody (native vs ERC-20),
   persist + emit `MerchantPaymentProcessed`.

5. **`getMerchantPaymentByRef(refId)`** — read function for backend
   verification.

6. **`sweepPlatformFees(token, recipient, amount)`** — treasury-only,
   bounded by `platformFeeAccrued[token]`.

7. **`sweepMerchantBacking(token, recipient, amount)`** — treasury-only,
   full owner discretion (no fee-counter mutation).

8. **`rotateBackendSigner(address next)`** — owner-only signer rotation.

9. **Events:** `MerchantPaymentProcessed`, `PlatformFeesSwept`,
   `BackendSignerRotated`.

10. **`QUOTE_TYPEHASH`** — immutable EIP-712 typehash.

## Rules (non-negotiable)

- **Additive only.** Existing `Transaction` struct, `getTransactionByRef`,
  `getTransactionsByAddress`, constructor, ownership — all untouched.
- **`payer` comes from `msg.sender`**, never from calldata.
- **`platformFeeAmount <= amount`** must be enforced on-chain (defense-in-depth).
- **Anti-replay** via `_consumedRefs[keccak256(refId)]` — single-use
  across the contract's lifetime.
- **EIP-712 domain separator** must include `chainId` + `verifyingContract`
  (use OpenZeppelin `EIP712.sol`).
- Use OpenZeppelin `ECDSA.sol` for signature recovery (rejects high-s).
- Use OpenZeppelin `SafeERC20` for `safeTransferFrom`.

## Acceptance

- [ ] All 8 on-chain invariants from §4.7 are enforced and tested.
- [ ] `processMerchantPayment` reverts with correct reason for each failure mode.
- [ ] `getMerchantPaymentByRef` returns the persisted struct.
- [ ] `sweepPlatformFees` cannot exceed `platformFeeAccrued[token]`.
- [ ] `sweepMerchantBacking` works independently of fee accounting.
- [ ] `rotateBackendSigner` emits `BackendSignerRotated` and updates state.
- [ ] Existing purchase-flow functions compile and pass their existing tests.
- [ ] Solidity unit tests cover all revert paths.

## Out of scope

- Testnet deployment (task 02).
- ABI export to TypeScript (task 03).
- `previousSigner` grace window for rotation (§11 open question — deferred).
