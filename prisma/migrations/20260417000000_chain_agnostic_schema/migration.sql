-- Chain-agnostic schema changes:
--   1. Blockchain.chainSlug — optional string id for non-EVM chains (e.g. Cosmos "cosmoshub-4", Solana cluster).
--   2. Token.contractAddress — drop global @unique; keep composite (blockchainId, contractAddress) as the source of truth.
--   3. NftAsset — replace numeric chainId with blockchainId FK → Blockchain.
--
-- DATA MIGRATION NOTE:
--   NftAsset.chainId is being replaced by a non-null FK to Blockchain. If this table has any rows,
--   backfill blockchainId BEFORE running this migration, e.g.:
--
--     UPDATE "NftAsset" na
--     SET "blockchainId" = b.id
--     FROM "Blockchain" b
--     WHERE b."chainId" = na."chainId";
--
--   Then drop the default on blockchainId if you added one for the backfill.

-- 1. Blockchain.chainSlug
ALTER TABLE "Blockchain" ADD COLUMN "chainSlug" TEXT;
CREATE UNIQUE INDEX "Blockchain_chainSlug_key" ON "Blockchain"("chainSlug");

-- 2. Drop Token.contractAddress standalone uniqueness (composite unique stays)
DROP INDEX IF EXISTS "Token_contractAddress_key";

-- 3. NftAsset: chainId -> blockchainId FK
ALTER TABLE "NftAsset" DROP CONSTRAINT IF EXISTS "NftAsset_walletAddress_contractAddress_tokenId_chainId_key";
DROP INDEX IF EXISTS "NftAsset_walletAddress_contractAddress_tokenId_chainId_key";

ALTER TABLE "NftAsset" ADD COLUMN "blockchainId" TEXT;

-- Backfill blockchainId from existing chainId using Blockchain.chainId lookup.
-- If rows remain with a NULL blockchainId after this, the ALTER ... SET NOT NULL below will fail —
-- that means there is data referencing a chainId with no matching Blockchain row.
UPDATE "NftAsset" na
SET "blockchainId" = b.id
FROM "Blockchain" b
WHERE b."chainId" = na."chainId"
  AND na."blockchainId" IS NULL;

ALTER TABLE "NftAsset" ALTER COLUMN "blockchainId" SET NOT NULL;
ALTER TABLE "NftAsset" DROP COLUMN "chainId";

ALTER TABLE "NftAsset"
  ADD CONSTRAINT "NftAsset_blockchainId_fkey"
  FOREIGN KEY ("blockchainId") REFERENCES "Blockchain"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "NftAsset_walletAddress_contractAddress_tokenId_blockchainId_key"
  ON "NftAsset"("walletAddress", "contractAddress", "tokenId", "blockchainId");

CREATE INDEX "NftAsset_blockchainId_idx" ON "NftAsset"("blockchainId");
