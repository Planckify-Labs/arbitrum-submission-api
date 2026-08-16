-- ERC-7540 asynchronous vaults (docs/defi-evm-protocol-expansion-spec.md §7).
--
-- Async vaults settle as request -> (off-chain fulfil) -> claim, which the
-- one-shot UnsignedCall model cannot express. The request must therefore be
-- durable: a position whose request nobody remembers is a user's funds in a
-- state the app cannot see. The claim-watcher worker scans by `asyncPhase`.
--
-- All columns are nullable and default NULL, so every existing (synchronous)
-- position keeps its current meaning and no backfill is required.
ALTER TABLE "StrategyPosition" ADD COLUMN "asyncPhase" TEXT;
ALTER TABLE "StrategyPosition" ADD COLUMN "asyncRequestId" TEXT;
ALTER TABLE "StrategyPosition" ADD COLUMN "asyncRequestedRaw" TEXT;
ALTER TABLE "StrategyPosition" ADD COLUMN "asyncRequestedAt" TIMESTAMP(3);
ALTER TABLE "StrategyPosition" ADD COLUMN "asyncCheckedAt" TIMESTAMP(3);
ALTER TABLE "StrategyPosition" ADD COLUMN "asyncTxHash" TEXT;

CREATE INDEX "StrategyPosition_asyncPhase_idx" ON "StrategyPosition"("asyncPhase");
