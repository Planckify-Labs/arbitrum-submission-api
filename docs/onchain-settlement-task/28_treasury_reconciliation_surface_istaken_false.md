# Task 28 — Ops query: outstanding token custody per token + swept amounts

**Status:** Not taken
**Owner:** Eng / Ops
**Spec reference:** `onchain-merchant-settlement-spec.md` §11a item 4

## Why this matters

Treasury needs to know how many tokens are custodied in the contract
(merchant-backing + platform fees) to plan off-ramp timing and size.
Without this surface, ops is flying blind on custody exposure — a
compliance and cash-flow risk.

## Scope

Build a reconciliation query or admin endpoint that reports:

1. **Outstanding custody per token:**
   - Sum of `OnchainSettlement`-linked `PaymentIntent.tokenAmountMinor`
     grouped by `sourceTokenId`, filtered to `status IN (SETTLED, PAID_OUT)`.
   - Cross-check against on-chain ERC-20 balance of the contract address
     (via `readContract` / `eth_getBalance`).

2. **Platform fee accounting per token:**
   - Sum of `PaymentIntent.platformFeeAmountMinor` for settled intents.
   - Cross-check against `platformFeeAccrued[token]` on-chain read.
   - Swept amount: sum of `PlatformFeesSwept` events (if indexed) or
     manual tracking.

3. **Reconciliation invariant** (§4.7a invariant 3):
   ```
   Σ MerchantPayment.platformFeeAmount per token
   == platformFeeAccrued[token] + Σ PlatformFeesSwept(amount)
   ```

4. **Output format:** JSON endpoint (`GET /admin/treasury/custody-report`)
   or a CLI script — whichever fits ops workflow. Requires admin auth.

## Rules (non-negotiable)

- **Admin-only.** Endpoint or script must require admin authentication.
- **On-chain reads are point-in-time.** Document that the report reflects
  the state at query time and may lag behind recent settlements.
- **Do not expose private keys or PII.** Report contains only aggregate
  token amounts and public contract addresses.

## Acceptance

- [ ] Report shows per-token outstanding custody (DB-derived).
- [ ] Report shows per-token on-chain balance (chain-derived).
- [ ] Report shows per-token platform fee accrual (DB + chain).
- [ ] Reconciliation invariant checked and drift flagged.
- [ ] Admin auth required.
- [ ] `pnpm run build` passes.

## Out of scope

- Automated off-ramp execution (§11a item 5 — manual for v1).
- `sweepPlatformFees` / `sweepMerchantBacking` tooling (contract-side,
  separate ops task).
- Per-merchant custody breakdown (not needed for v1).
