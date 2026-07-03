-- Pool-level DeFi deposits (docs/defi-pool-level-deposits-spec.md §4.2, §9.1).
-- Adds the `depositTarget` spine + pool-pinning fields so a deposit can route
-- to the EXACT DeFiLlama pool the user picked, not just the protocol's
-- canonical market. `depositTarget = null` degrades a pool to the manual
-- deep-link path (fail-closed).

-- OpportunityCache: disambiguate sibling pools + carry the resolved on-chain target.
ALTER TABLE "OpportunityCache" ADD COLUMN "poolMeta" TEXT;
ALTER TABLE "OpportunityCache" ADD COLUMN "depositTarget" JSONB;
ALTER TABLE "OpportunityCache" ADD COLUMN "targetResolvedAt" TIMESTAMP(3);

-- StrategyPosition: pin the exact DeFiLlama pool the position was opened against.
ALTER TABLE "StrategyPosition" ADD COLUMN "poolId" TEXT;

-- ProtocolScoreCache: protocol app URL for the manual deep-link homepage fallback.
ALTER TABLE "ProtocolScoreCache" ADD COLUMN "appUrl" TEXT;

-- Backfill poolMeta from the cached DeFiLlama payload in `raw` where present.
-- Older rows dropped it upstream; this is a best-effort safety net so grouping
-- has labels the moment the client stops dropping the field.
UPDATE "OpportunityCache"
SET "poolMeta" = "raw"->>'poolMeta'
WHERE jsonb_typeof("raw"->'poolMeta') = 'string'
  AND "poolMeta" IS NULL;

-- Backfill assetContract from the cached underlyingTokens[0] where present
-- (the deposited asset). Lowercased to match the runtime convention.
UPDATE "OpportunityCache"
SET "assetContract" = LOWER("raw"->'underlyingTokens'->>0)
WHERE jsonb_typeof("raw"->'underlyingTokens') = 'array'
  AND jsonb_array_length("raw"->'underlyingTokens') > 0
  AND "assetContract" IS NULL;
