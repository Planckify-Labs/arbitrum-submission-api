-- Migration: Setup TimescaleDB Hypertables for Scale
-- Target: Millions of users and transactions
-- Tables: TransactionHistory, AdminAuditLog
-- Also: Drop ApiRequestLog (moved to external logging service)

-- ============================================================================
-- STEP 1: Drop ApiRequestLog table (using external logging service instead)
-- ============================================================================
DROP TABLE IF EXISTS "ApiRequestLog" CASCADE;

-- ============================================================================
-- STEP 2: Convert TransactionHistory to TimescaleDB Hypertable
-- ============================================================================

-- 2.1 Create new table with composite primary key
CREATE TABLE "TransactionHistory_new" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(65,30) NOT NULL,
    "amountInFiat" DECIMAL(65,30),
    "fiatCurrency" TEXT,
    "txHash" TEXT,
    "senderAddress" TEXT,
    "recipientAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransactionHistory_new_pkey" PRIMARY KEY ("id", "createdAt")
);

-- 2.2 Migrate existing data (explicit columns to avoid order mismatch)
INSERT INTO "TransactionHistory_new" (
    "id", "userId", "tokenId", "type", "status", "amount",
    "amountInFiat", "fiatCurrency", "txHash", "senderAddress",
    "recipientAddress", "createdAt", "updatedAt"
)
SELECT
    "id", "userId", "tokenId", "type", "status", "amount",
    "amountInFiat", "fiatCurrency", "txHash", "senderAddress",
    "recipientAddress", "createdAt", "updatedAt"
FROM "TransactionHistory";

-- 2.3 Drop foreign key constraints referencing TransactionHistory
ALTER TABLE "Purchase" DROP CONSTRAINT IF EXISTS "Purchase_transactionId_fkey";

-- 2.4 Drop old table
DROP TABLE "TransactionHistory" CASCADE;

-- 2.5 Rename new table
ALTER TABLE "TransactionHistory_new" RENAME TO "TransactionHistory";

-- 2.6 Convert to hypertable with 7-day chunks (optimized for transaction queries)
SELECT create_hypertable(
    '"TransactionHistory"',
    'createdAt',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data => true
);

-- 2.7 Create unique constraint on (id, createdAt) for Purchase composite FK
CREATE UNIQUE INDEX "TransactionHistory_id_createdAt_key" ON "TransactionHistory"("id", "createdAt");

-- 2.8 Create index on id alone for fast lookups
CREATE INDEX "TransactionHistory_id_idx" ON "TransactionHistory"("id");

-- 2.9 Update Purchase table to add transactionCreatedAt column
ALTER TABLE "Purchase" ADD COLUMN "transactionCreatedAt" TIMESTAMP(3);

-- 2.10 Populate transactionCreatedAt from TransactionHistory
UPDATE "Purchase" p
SET "transactionCreatedAt" = t."createdAt"
FROM "TransactionHistory" t
WHERE p."transactionId" = t."id";

-- 2.11 Make transactionCreatedAt NOT NULL after population
ALTER TABLE "Purchase" ALTER COLUMN "transactionCreatedAt" SET NOT NULL;

-- 2.12 Drop old unique constraint on transactionId and create composite unique
DROP INDEX IF EXISTS "Purchase_transactionId_key";
CREATE UNIQUE INDEX "Purchase_transactionId_transactionCreatedAt_key"
    ON "Purchase"("transactionId", "transactionCreatedAt");

-- 2.14 Recreate foreign keys TO other tables
ALTER TABLE "TransactionHistory" ADD CONSTRAINT "TransactionHistory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TransactionHistory" ADD CONSTRAINT "TransactionHistory_tokenId_fkey"
    FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2.15 Create optimized indexes for common query patterns
CREATE INDEX "TransactionHistory_userId_createdAt_idx"
    ON "TransactionHistory" ("userId", "createdAt" DESC);

CREATE INDEX "TransactionHistory_status_createdAt_idx"
    ON "TransactionHistory" ("status", "createdAt" DESC);

CREATE INDEX "TransactionHistory_txHash_idx"
    ON "TransactionHistory" ("txHash")
    WHERE "txHash" IS NOT NULL;

CREATE INDEX "TransactionHistory_type_createdAt_idx"
    ON "TransactionHistory" ("type", "createdAt" DESC);

-- ============================================================================
-- STEP 3: Convert AdminAuditLog to TimescaleDB Hypertable
-- ============================================================================

-- 3.1 Create new table with composite primary key
CREATE TABLE "AdminAuditLog_new" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_new_pkey" PRIMARY KEY ("id", "createdAt")
);

-- 3.2 Migrate existing data (explicit columns to avoid order mismatch)
INSERT INTO "AdminAuditLog_new" (
    "id", "adminUserId", "action", "resource", "resourceId",
    "oldValues", "newValues", "ipAddress", "userAgent", "metadata", "createdAt"
)
SELECT
    "id", "adminUserId", "action", "resource", "resourceId",
    "oldValues", "newValues", "ipAddress", "userAgent", "metadata", "createdAt"
FROM "AdminAuditLog";

-- 3.3 Drop foreign key constraint
ALTER TABLE "AdminAuditLog" DROP CONSTRAINT IF EXISTS "AdminAuditLog_adminUserId_fkey";

-- 3.4 Drop old table
DROP TABLE "AdminAuditLog" CASCADE;

-- 3.5 Rename new table
ALTER TABLE "AdminAuditLog_new" RENAME TO "AdminAuditLog";

-- 3.6 Convert to hypertable with 7-day chunks
SELECT create_hypertable(
    '"AdminAuditLog"',
    'createdAt',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data => true
);

-- 3.7 Create index on id for lookups
-- Note: Cannot be UNIQUE without including createdAt (TimescaleDB limitation)
-- ULID guarantees uniqueness at application level
CREATE INDEX "AdminAuditLog_id_idx" ON "AdminAuditLog"("id");

-- 3.8 Recreate foreign key to User
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3.9 Create optimized indexes for common query patterns
CREATE INDEX "AdminAuditLog_adminUserId_createdAt_idx"
    ON "AdminAuditLog" ("adminUserId", "createdAt" DESC);

CREATE INDEX "AdminAuditLog_action_createdAt_idx"
    ON "AdminAuditLog" ("action", "createdAt" DESC);

CREATE INDEX "AdminAuditLog_resource_createdAt_idx"
    ON "AdminAuditLog" ("resource", "createdAt" DESC);

CREATE INDEX "AdminAuditLog_resourceId_idx"
    ON "AdminAuditLog" ("resourceId")
    WHERE "resourceId" IS NOT NULL;

-- ============================================================================
-- STEP 4: Enable TimescaleDB compression policies (for data older than 30 days)
-- ============================================================================

-- 4.1 Enable compression on TransactionHistory
ALTER TABLE "TransactionHistory" SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = '"userId"',
    timescaledb.compress_orderby = '"createdAt" DESC'
);

-- Add compression policy: compress chunks older than 30 days
SELECT add_compression_policy('"TransactionHistory"', INTERVAL '30 days');

-- 4.2 Enable compression on AdminAuditLog
ALTER TABLE "AdminAuditLog" SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = '"adminUserId"',
    timescaledb.compress_orderby = '"createdAt" DESC'
);

-- Add compression policy: compress chunks older than 30 days
SELECT add_compression_policy('"AdminAuditLog"', INTERVAL '30 days');

-- ============================================================================
-- STEP 5: Create continuous aggregates for analytics (optional but recommended)
-- ============================================================================

-- 5.1 Daily transaction summary per user
CREATE MATERIALIZED VIEW transaction_daily_summary
WITH (timescaledb.continuous) AS
SELECT
    "userId",
    time_bucket('1 day', "createdAt") AS day,
    "type",
    "status",
    COUNT(*) AS transaction_count,
    SUM("amount") AS total_amount,
    SUM("amountInFiat") AS total_fiat_amount
FROM "TransactionHistory"
GROUP BY "userId", time_bucket('1 day', "createdAt"), "type", "status"
WITH NO DATA;

-- Refresh policy: refresh daily aggregates every hour
SELECT add_continuous_aggregate_policy('transaction_daily_summary',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- 5.2 Daily admin activity summary
CREATE MATERIALIZED VIEW admin_audit_daily_summary
WITH (timescaledb.continuous) AS
SELECT
    "adminUserId",
    time_bucket('1 day', "createdAt") AS day,
    "action",
    "resource",
    COUNT(*) AS action_count
FROM "AdminAuditLog"
GROUP BY "adminUserId", time_bucket('1 day', "createdAt"), "action", "resource"
WITH NO DATA;

-- Refresh policy
SELECT add_continuous_aggregate_policy('admin_audit_daily_summary',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- ============================================================================
-- NOTES FOR PRODUCTION:
-- ============================================================================
-- 1. TransactionHistory: FK from Purchase is handled at application level
--    (hypertables don't support FK constraints pointing TO them efficiently)
--
-- 2. Compression: Data older than 30 days is automatically compressed
--    - Reduces storage by ~90%
--    - Queries on compressed data are still fast
--
-- 3. Continuous Aggregates: Pre-computed daily summaries for fast analytics
--    - transaction_daily_summary: Daily transaction stats per user
--    - admin_audit_daily_summary: Daily admin activity stats
--
-- 4. Chunk Interval: 7 days chosen for balance between:
--    - Query performance (not too many chunks to scan)
--    - Maintenance efficiency (reasonable chunk sizes)
--
-- 5. Retention Policy: Add if needed with:
--    SELECT add_retention_policy('"TransactionHistory"', INTERVAL '2 years');
--    SELECT add_retention_policy('"AdminAuditLog"', INTERVAL '7 years');
-- ============================================================================
