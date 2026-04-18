-- Add walletAddressLower column for namespace-aware auth lookup.
-- EVM addresses are case-insensitive — lookups happen via the lowered column.
-- Solana base58 is case-sensitive — we store the verbatim value in walletAddressLower
-- (application-level; this migration only backfills existing EVM rows).
ALTER TABLE "User" ADD COLUMN "walletAddressLower" TEXT;

UPDATE "User"
  SET "walletAddressLower" = LOWER("walletAddress")
  WHERE "walletAddress" IS NOT NULL;

CREATE UNIQUE INDEX "User_walletAddressLower_key" ON "User"("walletAddressLower");
