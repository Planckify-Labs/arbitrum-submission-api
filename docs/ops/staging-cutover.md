# Staging Cutover — Onchain Settlement Rail

## Steps

1. Set `PAYMENT_SETTLEMENT_RAIL=onchain` in staging env
2. Verify `Blockchain.takumiWalletContract` is populated for all active EVM chains:
   ```sql
   SELECT "name", "chainId", "takumiWalletContract"
   FROM "Blockchain"
   WHERE "isActive" = true AND "isEVM" = true;
   ```
   All rows must have a non-null `takumiWalletContract`.

3. Verify `Blockchain.quoteSignerAddress` matches derived address:
   ```bash
   # Derive address from QUOTE_SIGNER_PRIVATE_KEY
   cast wallet address --private-key $QUOTE_SIGNER_PRIVATE_KEY
   # Compare with DB value for each chain
   ```
   ```sql
   SELECT "name", "chainId", "quoteSignerAddress"
   FROM "Blockchain"
   WHERE "isActive" = true AND "isEVM" = true;
   ```

4. Verify `Blockchain.minConfirmations` is set per chain:
   ```sql
   SELECT "name", "chainId", "minConfirmations"
   FROM "Blockchain"
   WHERE "isActive" = true AND "isEVM" = true;
   ```
   Every row must have a non-null value per the tuning table in spec ss5.5.

5. Create a test intent -> pay on-chain -> verify SETTLED -> verify PAID_OUT:
   ```bash
   # 1. Create intent
   curl -X POST .../v1/pay/intents \
     -H "Authorization: Bearer $JWT" \
     -d '{"merchantId":"...", "fiatAmountMinor":15000, "currency":"IDR", "sourceTokenId":"...", "sourceChainId":5042002}'

   # 2. Sign and send processMerchantPayment on-chain using quoteCommitment + quoteSignature

   # 3. Submit txHash
   curl -X POST .../v1/pay/intents/$INTENT_ID/onchain \
     -H "Authorization: Bearer $JWT" \
     -d '{"txHash":"0x...", "chainId":5042002}'

   # 4. Verify SETTLED
   curl .../v1/pay/intents/$INTENT_ID -H "Authorization: Bearer $JWT"

   # 5. Wait for Xendit sandbox webhook -> verify PAID_OUT
   ```

6. Monitor for 24h: check OnchainSettlement failure rate, BAD_QUOTE reverts:
   ```sql
   -- Failure rate
   SELECT
     COUNT(*) FILTER (WHERE "failureCode" IS NOT NULL) AS failures,
     COUNT(*) AS total,
     ROUND(100.0 * COUNT(*) FILTER (WHERE "failureCode" IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS failure_pct
   FROM "OnchainSettlement"
   WHERE "createdAt" > NOW() - INTERVAL '24 hours';

   -- BAD_QUOTE reverts (needs contract event monitoring)
   SELECT "failureCode", COUNT(*)
   FROM "OnchainSettlement"
   WHERE "failureCode" IS NOT NULL
     AND "createdAt" > NOW() - INTERVAL '24 hours'
   GROUP BY "failureCode"
   ORDER BY COUNT(*) DESC;
   ```

## Rollback

Set `PAYMENT_SETTLEMENT_RAIL=nanopay` to revert to Circle Gateway rail.

No database migration rollback is needed -- the OnchainSettlement table and
schema additions are backward-compatible. Existing nanopay intents continue
to function regardless of the env setting.

## Checklist

- [ ] `PAYMENT_SETTLEMENT_RAIL=onchain` set in staging
- [ ] `Blockchain.takumiWalletContract` populated for all active EVM chains
- [ ] `Blockchain.quoteSignerAddress` matches derived address
- [ ] `Blockchain.minConfirmations` set per chain per tuning table
- [ ] Test intent round-trip successful (QUOTED -> SETTLED -> PAID_OUT)
- [ ] 24h monitoring period completed with acceptable failure rate
- [ ] BAD_QUOTE alert configured and tested
