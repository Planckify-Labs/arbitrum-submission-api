# Task 34 — Backend/CLI tooling for `sweepPlatformFees` / `sweepMerchantBacking`

**Status:** Not taken
**Owner:** Eng / Ops
**Spec reference:** `onchain-merchant-settlement-spec.md` §11a item 3

## Why this matters

The contract holds custodied tokens. Treasury needs a way to withdraw
accumulated tokens to the off-ramp wallet. The Solidity functions exist
(task 01), but without backend tooling to invoke them, ops must use
raw contract calls via Etherscan or a local script — error-prone and
unauditable.

## Scope

Build an admin-only tool (CLI script or admin API endpoint) that:

1. **`sweepPlatformFees(token, recipient, amount)`** — calls the
   contract function via viem `writeContract`. Reads
   `platformFeeAccrued[token]` first and validates `amount <= accrued`.

2. **`sweepMerchantBacking(token, recipient, amount)`** — calls the
   contract function. No accrued-counter bound (owner discretion), but
   logs the action with full context.

3. **Pre-flight checks:**
   - Confirm the caller has admin/owner authority.
   - Display current `platformFeeAccrued[token]` and contract token
     balance before executing.
   - Require explicit `--confirm` flag (CLI) or confirmation step (API).

4. **Audit trail:**
   - Log every sweep call with `(token, recipient, amount, txHash, timestamp, operator)`.
   - Optionally write to `AdminAuditLog` table.

5. **Multi-chain support:**
   - Accept `chainId` parameter.
   - Resolve contract address from `Blockchain.takumiWalletContract`.

**Implementation options (pick one):**
- **CLI script:** `src/scripts/sweep-treasury.ts` — run via
  `npx ts-node src/scripts/sweep-treasury.ts --chain 42161 --token 0x... --amount 1000000 --recipient 0x... --type platform-fees --confirm`.
- **Admin endpoint:** `POST /admin/treasury/sweep` with admin auth.

## Rules (non-negotiable)

- **Admin-only.** Either admin API auth or requires direct server access
  (CLI).
- **Explicit confirmation required.** No accidental sweeps.
- **Audit logged.** Every sweep is recorded.
- **Read-before-write.** Display the current state before executing.
- **Uses `ADMIN_WALLET_PRIVATE_KEY`** (or a dedicated treasury key) to
  sign the tx — this key must be the contract owner.

## Acceptance

- [ ] Tool can invoke `sweepPlatformFees` on a deployed contract.
- [ ] Tool can invoke `sweepMerchantBacking` on a deployed contract.
- [ ] Pre-flight displays accrued balance + contract balance.
- [ ] Confirmation gate prevents accidental execution.
- [ ] Sweep action is audit-logged.
- [ ] `pnpm run build` passes.

## Out of scope

- Automated/scheduled sweeps (manual for v1).
- Off-ramp execution (DEX/CEX integration — separate workstream per §11a
  item 5).
- Reconciliation dashboard (task 28).
