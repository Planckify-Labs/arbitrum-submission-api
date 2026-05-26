-- AlterTable: add DefiLlama-supplied chain label (works for EVM, Solana, Sui).
ALTER TABLE "OpportunityCache" ADD COLUMN "chainName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StrategyPosition" ADD COLUMN "chainName" TEXT NOT NULL DEFAULT '';

-- Backfill OpportunityCache from the cached DefiLlama payload in `raw`.
-- Rows polled before this migration carry the source label there.
UPDATE "OpportunityCache"
SET "chainName" = "raw"->>'chain'
WHERE "raw" ? 'chain' AND ("chainName" = '' OR "chainName" IS NULL);

-- Backfill StrategyPosition by matching on the (protocolSlug, chainId, namespace)
-- triple — same key the runtime uses when creating new positions.
UPDATE "StrategyPosition" sp
SET "chainName" = oc."chainName"
FROM "OpportunityCache" oc
WHERE oc."protocolSlug" = sp."protocolSlug"
  AND oc."chainId" = sp."chainId"
  AND oc."namespace" = sp."namespace"
  AND oc."chainName" <> ''
  AND (sp."chainName" = '' OR sp."chainName" IS NULL);
