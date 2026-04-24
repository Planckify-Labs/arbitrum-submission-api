# Monitoring & Alerting — Onchain Settlement

## Alerts to configure

### BAD_QUOTE Revert Spike

- **Query:** `OnchainSettlement` rows with `failureCode = 'BAD_QUOTE'` in last 5 min
  ```sql
  SELECT COUNT(*)
  FROM "OnchainSettlement"
  WHERE "failureCode" = 'BAD_QUOTE'
    AND "createdAt" > NOW() - INTERVAL '5 minutes';
  ```
- **Threshold:** > 3 in 5 minutes
- **Severity:** P0 (possible key rotation drift or forgery attempt)
- **Action:** Check `QUOTE_SIGNER_PRIVATE_KEY` matches `Blockchain.quoteSignerAddress`. If mismatch, follow the signer rotation runbook. If matched, investigate for attempted forgery — check source addresses and intent creation patterns.

### OnchainSettlement Failure Rate

- **Query:**
  ```sql
  SELECT
    COUNT(*) FILTER (WHERE "failureCode" IS NOT NULL) AS failures,
    COUNT(*) AS total
  FROM "OnchainSettlement"
  WHERE "createdAt" > NOW() - INTERVAL '15 minutes';
  ```
  Compute `failures / total`.
- **Threshold:** > 10%
- **Severity:** P1
- **Action:** Check chain RPC health, contract deployment status, confirmation thresholds. Common causes:
  - RPC endpoint degradation: check provider status page
  - Chain congestion: check block times vs expected
  - Contract state issue: verify contract is deployed at configured address
  - Confirmation threshold too high: check `Blockchain.minConfirmations` vs chain block time

### Expired Quote Rate

- **Query:**
  ```sql
  SELECT COUNT(*)
  FROM "PaymentIntent"
  WHERE "status" = 'EXPIRED'
    AND "path" = 'direct_arc'
    AND "createdAt" > NOW() - INTERVAL '1 hour';
  ```
  Compare against total `direct_arc` intents in the same window.
- **Threshold:** > 50% of direct_arc intents expire before payment
- **Severity:** P2 (UX issue — quotes expiring before customer can pay)
- **Action:** Consider increasing `QUOTE_TTL_DIRECT_ARC_SECONDS` from the default 900 (15 min). Check mobile UX for countdown visibility. Analyze time-to-pay distribution.

### Payout Failure After Settlement

- **Query:**
  ```sql
  SELECT pi."id", pi."status", pi."updatedAt"
  FROM "PaymentIntent" pi
  WHERE pi."status" = 'SETTLED'
    AND pi."updatedAt" < NOW() - INTERVAL '10 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM "ProviderPayout" pp
      WHERE pp."intentId" = pi."id"
        AND pp."status" IN ('COMPLETED', 'PROCESSING')
    );
  ```
- **Threshold:** > 5 intents stuck in SETTLED for > 10 minutes
- **Severity:** P1
- **Action:** Check Xendit/Duitku API health. Verify `PayoutService.trigger` is being called after settlement. Check BullMQ queue depth and worker health.

### Settlement Timeout Rate (SETTLING status)

- **Query:**
  ```sql
  SELECT COUNT(*)
  FROM "OnchainSettlement"
  WHERE "failureCode" = 'TIMEOUT'
    AND "createdAt" > NOW() - INTERVAL '15 minutes';
  ```
- **Threshold:** > 20% of settlement attempts
- **Severity:** P2
- **Action:** Check chain RPC responsiveness. May indicate chain congestion or RPC rate limiting. Consider increasing `waitForTransactionReceipt` timeout or using a backup RPC.

### Sender Mismatch Spike

- **Query:**
  ```sql
  SELECT COUNT(*)
  FROM "OnchainSettlement"
  WHERE "failureCode" = 'SENDER_MISMATCH'
    AND "createdAt" > NOW() - INTERVAL '30 minutes';
  ```
- **Threshold:** > 5 in 30 minutes
- **Severity:** P2 (possible mobile bug or front-running attempt)
- **Action:** Check mobile app version distribution. If isolated to specific payer addresses, investigate for potential abuse.

## Dashboard Queries

### Settlement Volume by Rail (last 24h)
```sql
SELECT
  pi."path",
  COUNT(*) AS total_intents,
  COUNT(*) FILTER (WHERE pi."status" = 'SETTLED') AS settled,
  COUNT(*) FILTER (WHERE pi."status" = 'PAID_OUT') AS paid_out,
  COUNT(*) FILTER (WHERE pi."status" = 'FAILED') AS failed,
  COUNT(*) FILTER (WHERE pi."status" = 'EXPIRED') AS expired
FROM "PaymentIntent" pi
WHERE pi."createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY pi."path";
```

### Onchain Settlement Failure Breakdown (last 24h)
```sql
SELECT
  "failureCode",
  COUNT(*) AS count,
  MIN("createdAt") AS first_seen,
  MAX("createdAt") AS last_seen
FROM "OnchainSettlement"
WHERE "failureCode" IS NOT NULL
  AND "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY "failureCode"
ORDER BY count DESC;
```

### Average Settlement Latency (last 24h)
```sql
SELECT
  AVG(EXTRACT(EPOCH FROM (os."verifiedAt" - os."createdAt"))) AS avg_seconds,
  PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (os."verifiedAt" - os."createdAt"))
  ) AS p95_seconds
FROM "OnchainSettlement" os
WHERE os."verifiedAt" IS NOT NULL
  AND os."createdAt" > NOW() - INTERVAL '24 hours';
```
