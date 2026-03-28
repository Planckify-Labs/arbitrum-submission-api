-- ============================================================
-- Convert PointTransaction to TimescaleDB Hypertable
-- ============================================================
-- PointTransaction is an append-only point ledger that mirrors
-- the structure of TransactionHistory. Same pattern applies:
--   1. Rebuild table with composite PK (id, createdAt)
--   2. Convert to hypertable
--   3. Add pointTransactionCreatedAt to PointRedemption so it
--      can hold a composite FK (same as Purchase → TransactionHistory)
-- ============================================================

-- ============================================================
-- STEP 1: Rebuild PointTransaction with composite PK
-- ============================================================

-- 1.1 Create new table with composite primary key
CREATE TABLE "PointTransaction_new" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "type"            "PointTransactionType" NOT NULL,
    "amount"          BIGINT NOT NULL,
    "balanceBefore"   BIGINT NOT NULL,
    "balanceAfter"    BIGINT NOT NULL,
    "refId"           TEXT,
    "txHash"          TEXT,
    "tokenId"         TEXT,
    "blockchainId"    TEXT,
    "contractAddress" TEXT,
    "tokenAmount"     DECIMAL(36,18),
    "pointRate"       DECIMAL(18,8),
    "referenceType"   TEXT,
    "referenceId"     TEXT,
    "status"          "PointTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "metadata"        JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointTransaction_new_pkey" PRIMARY KEY ("id", "createdAt")
);

-- 1.2 Migrate existing data
INSERT INTO "PointTransaction_new" (
    "id", "userId", "type", "amount", "balanceBefore", "balanceAfter",
    "refId", "txHash", "tokenId", "blockchainId", "contractAddress",
    "tokenAmount", "pointRate", "referenceType", "referenceId",
    "status", "metadata", "createdAt"
)
SELECT
    "id", "userId", "type", "amount", "balanceBefore", "balanceAfter",
    "refId", "txHash", "tokenId", "blockchainId", "contractAddress",
    "tokenAmount", "pointRate", "referenceType", "referenceId",
    "status", "metadata", "createdAt"
FROM "PointTransaction";

-- 1.3 Drop FK from PointRedemption before dropping the table
ALTER TABLE "PointRedemption" DROP CONSTRAINT IF EXISTS "PointRedemption_pointTransactionId_fkey";

-- 1.4 Drop old table (CASCADE removes any remaining dependent objects)
DROP TABLE "PointTransaction" CASCADE;

-- 1.5 Rename new table
ALTER TABLE "PointTransaction_new" RENAME TO "PointTransaction";

-- ============================================================
-- STEP 2: Convert to hypertable
-- ============================================================

SELECT create_hypertable(
    '"PointTransaction"',
    'createdAt',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data        => true
);

-- ============================================================
-- STEP 3: Recreate indexes and constraints on PointTransaction
-- ============================================================

-- Composite unique required for FK from PointRedemption
CREATE UNIQUE INDEX "PointTransaction_id_createdAt_key"
    ON "PointTransaction" ("id", "createdAt");

-- Note: refId and txHash cannot be UNIQUE indexes on a hypertable without
-- including the partitioning column (createdAt). Uniqueness is enforced at
-- the application level via idempotency checks before insert.

-- Query hot paths
CREATE INDEX "PointTransaction_userId_createdAt_idx"
    ON "PointTransaction" ("userId", "createdAt" DESC);

CREATE INDEX "PointTransaction_status_createdAt_idx"
    ON "PointTransaction" ("status", "createdAt" DESC);

CREATE INDEX "PointTransaction_txHash_idx"
    ON "PointTransaction" ("txHash");

CREATE INDEX "PointTransaction_refId_idx"
    ON "PointTransaction" ("refId");

-- Recreate FKs from PointTransaction to other tables
ALTER TABLE "PointTransaction"
    ADD CONSTRAINT "PointTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PointTransaction"
    ADD CONSTRAINT "PointTransaction_tokenId_fkey"
    FOREIGN KEY ("tokenId") REFERENCES "Token"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PointTransaction"
    ADD CONSTRAINT "PointTransaction_blockchainId_fkey"
    FOREIGN KEY ("blockchainId") REFERENCES "Blockchain"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- STEP 4: Update PointRedemption for composite FK
-- ============================================================

-- 4.1 Add the new column (nullable initially for backfill)
ALTER TABLE "PointRedemption"
    ADD COLUMN "pointTransactionCreatedAt" TIMESTAMP(3);

-- 4.2 Backfill from PointTransaction
UPDATE "PointRedemption" pr
SET "pointTransactionCreatedAt" = pt."createdAt"
FROM "PointTransaction" pt
WHERE pr."pointTransactionId" = pt."id";

-- 4.3 Enforce NOT NULL after backfill
ALTER TABLE "PointRedemption"
    ALTER COLUMN "pointTransactionCreatedAt" SET NOT NULL;

-- 4.4 Drop old single-column unique index on pointTransactionId
DROP INDEX IF EXISTS "PointRedemption_pointTransactionId_key";

-- 4.5 Composite unique (one redemption per point transaction)
CREATE UNIQUE INDEX "PointRedemption_pointTransactionId_pointTransactionCreatedAt_key"
    ON "PointRedemption" ("pointTransactionId", "pointTransactionCreatedAt");

-- 4.6 Recreate FK as composite
ALTER TABLE "PointRedemption"
    ADD CONSTRAINT "PointRedemption_pointTransactionId_fkey"
    FOREIGN KEY ("pointTransactionId", "pointTransactionCreatedAt")
    REFERENCES "PointTransaction" ("id", "createdAt")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- STEP 5: Compression + retention policies
-- ============================================================

ALTER TABLE "PointTransaction" SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = '"userId","status"',
    timescaledb.compress_orderby   = '"createdAt" DESC'
);

-- Compress chunks older than 30 days
SELECT add_compression_policy('"PointTransaction"', INTERVAL '30 days',
    if_not_exists => TRUE);

-- Retain 2 years of point history (regulatory/audit requirement)
SELECT add_retention_policy('"PointTransaction"', INTERVAL '2 years',
    if_not_exists => TRUE);
