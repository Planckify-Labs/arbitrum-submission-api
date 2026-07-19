-- Drop the walletAddressLower fold column.
--
-- Its job (case-insensitive dedup of the same wallet) now lives on
-- `walletAddress` itself: writes go through `canonicalizeWalletAddress`
-- (checksummed EVM / verbatim Solana+Stellar), so `walletAddress @unique`
-- is the correct case-insensitive key by itself.
--
-- IMPORTANT (expand/contract ordering): run
--   `pnpm backfill:canonical-address --apply`
-- against this database FIRST so every existing `walletAddress` is already
-- canonical, THEN deploy the new application code, THEN apply this migration.
-- Dropping the column while old code still SELECTs it would error.
--
-- DropIndex
DROP INDEX "User_walletAddressLower_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "walletAddressLower";
