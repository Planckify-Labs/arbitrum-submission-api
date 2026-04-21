-- Task 38: `POST /v1/pay/intents/:id/deposit-receipt` uses the on-chain txHash
-- as the natural idempotency key. A unique constraint enforces that at the DB
-- layer so a replayed receipt POST returns 200 with the existing row instead
-- of silently creating a duplicate `gateway_deposits` audit entry.
--
-- Spec ref: umkm-usdc-payout-spec.md §6.6 `gateway_deposits` (CONFIRMED rows
-- are per-user-per-chain; txHash uniqueness is the audit-trail invariant).

-- CreateIndex
CREATE UNIQUE INDEX "GatewayDeposit_txHash_key" ON "GatewayDeposit"("txHash");
