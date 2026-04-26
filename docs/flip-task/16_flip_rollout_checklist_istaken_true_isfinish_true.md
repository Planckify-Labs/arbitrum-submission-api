# Task 16 — Rollout checklist — merchant config + verification + rollback plan

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §13

## Why this matters

All code tasks can be complete and passing tests, but the provider
is not live until: (1) `ProviderChannel` rows are seeded in prod,
(2) Flip prod credentials are configured, (3) at least one merchant
is set to `payoutProvider = "flip"`, and (4) the team knows how to
roll back. This task captures the non-code steps from spec §13 so
nothing falls through the cracks between "code merged" and "first
real payout."

**Depends on:** all previous tasks (code is merged and tested).

## Scope

### Pre-rollout verification

- [ ] **Prod env vars set:** `FLIP_SECRET_KEY` (prod key, not sandbox),
      `FLIP_VALIDATION_TOKEN` (prod token), `FLIP_API_BASE` set to
      `https://bigflip.id/api/v2`.
- [ ] **`ProviderChannel` rows seeded in prod** (task 14) — verify
      with a DB query:
      ```sql
      SELECT * FROM "ProviderChannel" WHERE provider = 'flip';
      ```
- [ ] **Webhook URL registered in Flip dashboard:** Configure the
      production callback URL (`POST /webhooks/flip`) in the Flip for
      Business dashboard.
- [ ] **Flip validation token matches:** The `FLIP_VALIDATION_TOKEN`
      env var matches the token configured in the Flip dashboard.
- [ ] **Balance check:** Run `checkBalance()` (task 15) against prod
      to verify auth works and balance is sufficient.
- [ ] **Rate limits confirmed:** Contact `b2b-api-integration@flip.id`
      for production rate limits (spec §14 item 2).

### Merchant onboarding

- [ ] **Select pilot merchant(s):** Choose low-volume UMKM merchant(s)
      for initial rollout.
- [ ] **Update merchant config:**
      ```sql
      UPDATE "Merchant"
      SET "payoutProvider" = 'flip'
      WHERE id = '<pilot_merchant_id>';
      ```
- [ ] **Verify first payout:** Trigger a real payout for the pilot
      merchant and confirm end-to-end: disbursement created → webhook
      received → `ProviderPayout` updated to `COMPLETED` →
      `PaymentIntent` updated to `PAID_OUT`.

### Rollback plan

Per spec §13 item 4:

- **Rollback:** Set `merchant.payoutProvider` back to `"xendit"` or
  `"duitku"`. Single SQL update per merchant.
- **In-flight payouts:** Flip payouts already created continue to
  receive webhooks and reconcile normally — the webhook endpoint stays
  active regardless of the merchant's current provider setting.
- **No code rollback needed:** The Flip adapter stays deployed; only
  the merchant-level config determines routing.

### Open questions to resolve before rollout

From spec §14:

- [ ] **E-wallet fee structure (§14 item 1):** Confirm whether GoPay,
      OVO, etc. have different fees. Update `ProviderChannel.feeIdr`
      if needed.
- [ ] **Timestamp timezone (§14 item 5):** Confirm Flip returns GMT+7.
      Decide whether to store as-is or convert to UTC. (v1: store raw
      in `providerResponseBody`.)

## Rules (non-negotiable)

- **Do not set any merchant to `"flip"` before all pre-rollout checks
  pass.**
- **Pilot with low-volume merchants first.** Do not bulk-migrate
  merchants to Flip on day one.
- **Document the rollback command.** Ops should be able to roll back
  a merchant in under 60 seconds.

## Acceptance

- [ ] All pre-rollout verification items checked off.
- [ ] At least one pilot merchant completes a real end-to-end payout
      via Flip.
- [ ] Rollback plan documented and tested (switch merchant back,
      verify next payout routes to previous provider).
- [ ] Open questions from spec §14 resolved or explicitly accepted
      as known risks.

## Out of scope

- Bulk merchant migration to Flip — future work based on pilot results.
- Automated failover between providers — future work.
- Flip SNAP API compliance — deferred (spec §14 item 3 from Duitku
  context, not applicable to Flip).
