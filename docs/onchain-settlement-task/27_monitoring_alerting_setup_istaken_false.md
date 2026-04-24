# Task 27 — Alerts for `BAD_QUOTE` revert spike + `OnchainSettlement` failure rate

**Status:** Not taken
**Owner:** Ops / Eng
**Spec reference:** `onchain-merchant-settlement-spec.md` §12.7 items 17–18

## Why this matters

A `BAD_QUOTE` revert spike signals either attempted forgery or a signer
key rotation drift — both P0 incidents. Elevated `OnchainSettlement`
failure rates catch chain issues, contract bugs, or mobile regressions
before they affect enough customers to be noticed organically.

## Scope

1. **`BAD_QUOTE` revert alert:**
   - Source: contract event logs (if indexed) or backend
     `OnchainSettlement.failureCode = "CONTRACT_DATA_MISMATCH"` /
     mobile-reported revert reasons.
   - Threshold: > 3 occurrences in a 15-minute window.
   - Action: page on-call + flag for signer-key investigation.

2. **Settlement failure rate alert:**
   - Source: `OnchainSettlement` rows with non-null `failureCode`.
   - Baseline: establish during staging bake (task 26).
   - Threshold: failure rate > 2× baseline over a 30-minute window.
   - Action: page on-call.

3. **Dashboard:**
   - Settlement success/failure count by `failureCode` (time series).
   - Settlement latency (time from `POST /onchain` to `verifiedAt`).
   - Quote expiration rate (intents that reach `EXPIRED` without
     settlement attempt).
   - `platformFeeAccrued` per token (on-chain read, periodic).

## Rules (non-negotiable)

- **Alerts must be configured before staging cutover** (task 26).
- **Use existing monitoring infrastructure** (Grafana, PostHog, or
  whatever the project uses).
- **`BAD_QUOTE` alert is non-negotiable** — it's the signer-compromise
  early-warning system.

## Acceptance

- [ ] `BAD_QUOTE` spike alert configured and tested (fire a test alert).
- [ ] Settlement failure rate alert configured.
- [ ] Dashboard shows settlement metrics.
- [ ] On-call runbook updated with response steps for each alert.

## Out of scope

- Application-level logging changes (adapter already logs failure codes).
- DR drill (§12.7 item 19 — separate ops exercise).
