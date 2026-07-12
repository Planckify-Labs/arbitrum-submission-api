-- Stellar-specific fields (Soroban `takumi_pay` contract integration).
-- `rpcUrl` on Stellar rows carries the Horizon URL (classic-op reads, used
-- by the mobile wallet) -- Soroban contract reads/simulation need the
-- separate Soroban RPC endpoint, hence its own column rather than
-- repurposing `rpcUrl`.
ALTER TABLE "Blockchain" ADD COLUMN "takumiPayContractId" TEXT;
ALTER TABLE "Blockchain" ADD COLUMN "stellarSorobanRpcUrl" TEXT;
