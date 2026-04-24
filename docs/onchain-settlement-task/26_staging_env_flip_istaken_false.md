# Task 26 — Flip staging to `PAYMENT_SETTLEMENT_RAIL=onchain` + validate round-trip

**Status:** Not taken
**Owner:** Eng / Ops
**Spec reference:** `onchain-merchant-settlement-spec.md` §10 Phase 5

## Why this matters

Staging cutover is the final validation before production. It proves
the full flow works against real (testnet) infrastructure: customer
scan → on-chain pay → backend verify → Xendit/Duitku sandbox
disbursement. Two weeks of staging bake-time catches issues that unit
and e2e tests can't (timing, gas estimation, rate refresh, webhook
reliability).

## Scope

1. **Deploy** all Phase 0–4 code to the staging environment.
2. **Set env:** `PAYMENT_SETTLEMENT_RAIL=onchain` in staging config.
3. **Populate DB:**
   - `Blockchain` rows for staging chains with `takumiWalletContract`,
     `quoteSignerAddress`, `minConfirmations`.
   - `Token` rows with `isPaymentEnabled = true` for USDC + USDT.
   - `Token.platformFeeBps` set per finance guidance.
4. **Validate round-trip** (manual or scripted):
   - Create intent via API.
   - Execute `processMerchantPayment` on testnet contract.
   - Submit txHash via `POST /v1/pay/intents/:id/onchain`.
   - Verify settlement → payout trigger → Xendit/Duitku sandbox callback.
   - Verify `PaymentIntent` reaches `PAID_OUT`.
5. **Run for 1–2 weeks.** Monitor for:
   - Revert reason distribution (any `BAD_QUOTE` → signer issue).
   - Settlement failure rate.
   - Quote expiration rate (too many `QUOTE_EXPIRED` → TTL too short
     or mobile UX issue).
   - Reconciliation drift (§4.7a invariant 3).

## Rules (non-negotiable)

- **Staging only.** Do not touch production env.
- **Existing nanopay intents in staging** must continue to work (rails
  are per-intent; existing intents keep their `path`).
- **Finance sign-off** on `Token.platformFeeBps` values before enabling.
- **Pre-launch checklist** (§12.7) items 11–14 must be verified during
  staging bake.

## Acceptance

- [ ] Staging env has `PAYMENT_SETTLEMENT_RAIL=onchain`.
- [ ] At least one full round-trip validated end-to-end.
- [ ] 1-week bake with no P0/P1 issues.
- [ ] Monitoring dashboards (task 27) showing data.

## Out of scope

- Production cutover.
- Per-merchant preference (Phase 6 in spec).
- Multi-sig owner migration (§12.7 item 4 — separate ops task).
