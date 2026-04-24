# Task 36 — Signer rotation runbook + `previousSigner` contract grace window

**Status:** Not taken
**Owner:** Eng / Ops
**Spec reference:** `onchain-merchant-settlement-spec.md` §11 (open questions), §12.5, §12.7 item 7

## Why this matters

The quote signer key is the root of trust for the onchain rail. If it's
compromised or needs rotation, the 5-step process must be executed
without error — and the contract must handle in-flight quotes signed by
the prior key. Without a `previousSigner` grace window, ~15 minutes of
customer payments revert with `BAD_QUOTE` after every rotation.

## Scope

### Solidity: `previousSigner` grace window

Extend the contract (additive to task 01):

```solidity
address public previousSigner;
uint256 public previousSignerValidUntil; // block.timestamp

function rotateBackendSigner(address next) external onlyOwner {
    previousSigner = backendSigner;
    previousSignerValidUntil = block.timestamp + 30 minutes;
    emit BackendSignerRotated(backendSigner, next);
    backendSigner = next;
}

function clearPreviousSigner() external onlyOwner {
    previousSigner = address(0);
    previousSignerValidUntil = 0;
}
```

Update `processMerchantPayment` signature check:

```solidity
address recovered = ECDSA.recover(digest, backendSignature);
require(
    recovered == backendSigner ||
    (recovered == previousSigner && block.timestamp <= previousSignerValidUntil),
    "BAD_QUOTE"
);
```

### Runbook document

Create `docs/runbooks/quote-signer-rotation.md`:

1. Generate new key in HSM/KMS.
2. Multi-sig executes `rotateBackendSigner(newAddress)` — old key moves
   to `previousSigner` with 30-min grace.
3. Update `Blockchain.quoteSignerAddress` rows for all active chains.
4. Update `QUOTE_SIGNER_PRIVATE_KEY` in env, deploy service.
5. After 30 min, call `clearPreviousSigner()`.
6. Audit any signed-but-unredeemed quotes from the rotation window.

Include: pre-flight checklist, rollback steps if something goes wrong,
communication template for mobile team.

### Solidity tests

- Test: rotate signer → old-key quote still valid within 30 min.
- Test: rotate signer → old-key quote rejected after 30 min.
- Test: `clearPreviousSigner` → old-key quote immediately rejected.

## Rules (non-negotiable)

- **30-minute grace** — matches max quote TTL (15 min) + buffer.
- **`clearPreviousSigner` is explicit.** Grace doesn't auto-expire
  (safer — ops controls the cutoff).
  - Actually the implementation above does auto-expire via
    `block.timestamp <= previousSignerValidUntil`. Both the time-based
    expiry AND the manual clear should work.
- **Runbook must be walked through** in a tabletop drill before mainnet
  (§12.7 item 15).

## Acceptance

- [ ] Contract supports `previousSigner` with 30-min grace window.
- [ ] `clearPreviousSigner` works.
- [ ] Solidity tests cover grace window acceptance + rejection.
- [ ] Runbook document created and reviewed.
- [ ] `pnpm run build` passes.

## Out of scope

- HSM/KMS integration (ops infrastructure).
- Tabletop drill execution (§12.7 item 15 — ops exercise).
