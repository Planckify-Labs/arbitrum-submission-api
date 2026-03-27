-- ============================================================
-- TimescaleDB Hypertable Setup + Performance Indexes
-- ============================================================
-- Run AFTER the base schema is applied.
-- Idempotent: all blocks use IF NOT EXISTS / exception guards.
-- ============================================================

-- Enable TimescaleDB extension (idempotent)
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ============================================================
-- 1. ExchangeRate hypertable
-- ============================================================
-- The composite PK (id, createdAt) is required by TimescaleDB
-- so the partitioning column (createdAt) is part of the PK.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'ExchangeRate'
  ) THEN
    PERFORM create_hypertable(
      '"ExchangeRate"',
      'createdAt',
      chunk_time_interval => INTERVAL '1 day',
      if_not_exists       => TRUE
    );
    RAISE NOTICE 'ExchangeRate hypertable created';
  END IF;
END $$;

-- Compression: compress chunks older than 7 days
-- segmentby = query hot-path columns; orderby = range predicate
ALTER TABLE "ExchangeRate" SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = '"fromCurrency","toCurrency"',
  timescaledb.compress_orderby   = '"createdAt" DESC'
);

SELECT add_compression_policy('"ExchangeRate"', INTERVAL '7 days',
  if_not_exists => TRUE);

-- Retention: drop chunks older than 90 days
SELECT add_retention_policy('"ExchangeRate"', INTERVAL '90 days',
  if_not_exists => TRUE);

-- ============================================================
-- 2. TransactionHistory hypertable
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'TransactionHistory'
  ) THEN
    PERFORM create_hypertable(
      '"TransactionHistory"',
      'createdAt',
      chunk_time_interval => INTERVAL '1 day',
      if_not_exists       => TRUE
    );
    RAISE NOTICE 'TransactionHistory hypertable created';
  END IF;
END $$;

ALTER TABLE "TransactionHistory" SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = '"userId","status"',
  timescaledb.compress_orderby   = '"createdAt" DESC'
);

SELECT add_compression_policy('"TransactionHistory"', INTERVAL '30 days',
  if_not_exists => TRUE);

SELECT add_retention_policy('"TransactionHistory"', INTERVAL '365 days',
  if_not_exists => TRUE);

-- ============================================================
-- 3. Continuous Aggregate — hourly exchange rate OHLCV
-- ============================================================
-- Pre-computes min/max/avg rates per hour per pair so analytics
-- queries don't scan raw rows.

CREATE MATERIALIZED VIEW IF NOT EXISTS exchange_rate_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', "createdAt") AS bucket,
  "fromCurrency",
  "toCurrency",
  "region",
  first("rate", "createdAt")  AS open,
  max("rate")                  AS high,
  min("rate")                  AS low,
  last("rate", "createdAt")   AS close,
  avg("rate")                  AS avg_rate,
  count(*)                     AS sample_count
FROM "ExchangeRate"
GROUP BY bucket, "fromCurrency", "toCurrency", "region"
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'exchange_rate_hourly',
  start_offset  => INTERVAL '3 hours',
  end_offset    => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- ============================================================
-- 4. New indexes from schema optimizations
-- ============================================================

-- ProductPrice: variant and vendor lookups (hot path in purchase processor)
CREATE INDEX IF NOT EXISTS "ProductPrice_productVariantId_idx"
  ON "ProductPrice" ("productVariantId");

CREATE INDEX IF NOT EXISTS "ProductPrice_vendorId_idx"
  ON "ProductPrice" ("vendorId");

CREATE INDEX IF NOT EXISTS "ProductPrice_productVariantId_vendorId_isActive_idx"
  ON "ProductPrice" ("productVariantId", "vendorId", "isActive");

-- BookingOrder: rate-limit guard queries by walletAddress + createdAt
CREATE INDEX IF NOT EXISTS "BookingOrder_walletAddress_createdAt_idx"
  ON "BookingOrder" ("walletAddress", "createdAt" DESC);

-- BookingOrder: status + time scoped (avoids hot index on single PENDING value)
CREATE INDEX IF NOT EXISTS "BookingOrder_status_createdAt_idx"
  ON "BookingOrder" ("status", "createdAt" DESC);

-- PointTransaction: status + time (replaces plain status index)
-- The plain status index causes a hot index problem for PENDING rows
DROP INDEX IF EXISTS "PointTransaction_status_idx";
CREATE INDEX IF NOT EXISTS "PointTransaction_status_createdAt_idx"
  ON "PointTransaction" ("status", "createdAt" DESC);

-- ============================================================
-- 5. ExchangeRate query helper index
-- ============================================================
-- Speeds up "latest rate for pair X" queries:
-- SELECT * FROM "ExchangeRate" WHERE "fromCurrency"=? AND "toCurrency"=?
-- ORDER BY "createdAt" DESC LIMIT 1

CREATE INDEX IF NOT EXISTS "ExchangeRate_pair_createdAt_idx"
  ON "ExchangeRate" ("fromCurrency", "toCurrency", "createdAt" DESC);
