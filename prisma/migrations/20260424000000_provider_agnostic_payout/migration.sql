-- Provider-agnostic payout refactor (tasks 01 + 02 from docs/duitku-task).
--
-- The table is renamed in place (ALTER ... RENAME) so every existing Xendit
-- payout / merchant / channel row survives bit-for-bit. The Xendit adapter's
-- wire body does not change — only the TS/SQL identifiers do.
--
-- Ordering is load-bearing:
--   1. Enum rename (ALTER TYPE is metadata-only, fast).
--   2. Table + column renames on ProviderPayout / Merchant (row-preserving).
--   3. Add `provider` column NULLABLE, backfill to 'xendit', then SET NOT NULL.
--   4. Create ProviderChannel + backfill from Channel BEFORE dropping Channel cols.
--   5. Drop the now-migrated xendit* columns on Channel.

-- 1. Enum rename.
ALTER TYPE "XenditPayoutStatus" RENAME TO "ProviderPayoutStatus";

-- 2. Table rename + column renames on ProviderPayout.
ALTER TABLE "XenditPayout" RENAME TO "ProviderPayout";
ALTER TABLE "ProviderPayout" RENAME COLUMN "xenditPayoutId"     TO "providerPayoutId";
ALTER TABLE "ProviderPayout" RENAME COLUMN "xenditResponseBody" TO "providerResponseBody";

-- Rename the PK constraint + index so Prisma introspection stays aligned.
ALTER INDEX "XenditPayout_pkey" RENAME TO "ProviderPayout_pkey";
ALTER INDEX "XenditPayout_intentId_idx" RENAME TO "ProviderPayout_intentId_idx";

-- Rename the FK constraint as well (intent FK).
ALTER TABLE "ProviderPayout" RENAME CONSTRAINT "XenditPayout_intentId_fkey" TO "ProviderPayout_intentId_fkey";

-- 3. New provider column (backfilled, then locked NOT NULL).
ALTER TABLE "ProviderPayout" ADD COLUMN "provider" TEXT;
UPDATE "ProviderPayout" SET "provider" = 'xendit' WHERE "provider" IS NULL;
ALTER TABLE "ProviderPayout" ALTER COLUMN "provider" SET NOT NULL;

-- New providerResponseCode column (nullable — Xendit rows legitimately null).
ALTER TABLE "ProviderPayout" ADD COLUMN "providerResponseCode" TEXT;

-- Index for reconcile job scans: cheap lookup of non-terminal rows per provider.
CREATE INDEX "ProviderPayout_provider_status_idx" ON "ProviderPayout"("provider", "status");

-- 2b. Column renames on Merchant.
ALTER TABLE "Merchant" RENAME COLUMN "xenditChannelCode"       TO "payoutChannelCode";
ALTER TABLE "Merchant" RENAME COLUMN "xenditAccountNumber"     TO "payoutAccountNumber";
ALTER TABLE "Merchant" RENAME COLUMN "xenditAccountHolderName" TO "payoutAccountHolderName";

-- 4. Create ProviderChannel.
CREATE TABLE "ProviderChannel" (
    "id" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerChannelCode" TEXT NOT NULL,
    "minAmountIdr" INTEGER,
    "maxAmountIdr" INTEGER,
    "feeIdr" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ProviderChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderChannel_channelCode_country_provider_key"
  ON "ProviderChannel"("channelCode", "country", "provider");

CREATE INDEX "ProviderChannel_provider_isActive_idx"
  ON "ProviderChannel"("provider", "isActive");

ALTER TABLE "ProviderChannel"
  ADD CONSTRAINT "ProviderChannel_channelCode_country_fkey"
  FOREIGN KEY ("channelCode", "country")
  REFERENCES "Channel"("channelCode", "country")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing Channel row mirrors as a Xendit ProviderChannel.
-- `providerChannelCode` = canonical `channelCode` because Xendit's codes
-- match the canonical values today (BCA → BCA, GOPAY → GOPAY).
INSERT INTO "ProviderChannel" (
    "id", "channelCode", "country", "provider", "providerChannelCode",
    "minAmountIdr", "maxAmountIdr", "feeIdr", "isActive", "createdAt", "updatedAt"
)
SELECT
    -- Deterministic-looking id; Prisma ULID gen is client-side so we mint a
    -- 26-char id on the DB side via gen_random_uuid shortened — fine because
    -- this is one-off backfill data.
    substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 26),
    "channelCode",
    "country",
    'xendit',
    "channelCode",
    "xenditMinAmountIdr",
    "xenditMaxAmountIdr",
    "xenditFeeIdr",
    "isActive",
    "createdAt",
    "updatedAt"
FROM "Channel";

-- 5. Drop the now-migrated Xendit columns from Channel — only AFTER backfill.
ALTER TABLE "Channel" DROP COLUMN "xenditMinAmountIdr";
ALTER TABLE "Channel" DROP COLUMN "xenditMaxAmountIdr";
ALTER TABLE "Channel" DROP COLUMN "xenditFeeIdr";
