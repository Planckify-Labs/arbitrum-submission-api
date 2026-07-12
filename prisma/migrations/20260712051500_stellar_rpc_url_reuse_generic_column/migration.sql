-- Reuses the generic `rpcUrl` column for Stellar's Soroban RPC endpoint
-- instead of a dedicated `stellarSorobanRpcUrl` column, matching every
-- other chain (one endpoint column per chain). Accepts that the mobile
-- wallet's Horizon-URL expectation for `rpcUrl` on Stellar rows is now
-- stale -- a separate, not-yet-reconciled concern in that repo.

UPDATE "Blockchain"
SET "rpcUrl" = "stellarSorobanRpcUrl"
WHERE "type" = 'STELLAR' AND "stellarSorobanRpcUrl" IS NOT NULL;

ALTER TABLE "Blockchain" DROP COLUMN "stellarSorobanRpcUrl";
