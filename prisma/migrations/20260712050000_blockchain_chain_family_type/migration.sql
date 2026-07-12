-- Adds Blockchain.type (chain family: EVM | SVM | MOVE_VM | STELLAR),
-- validated at the application layer (see src/blockchains/chain-family.ts)
-- rather than as a Postgres enum, so adding a new chain family later never
-- needs a schema migration -- only a new chain within an existing family
-- (the common case) already needed none.
--
-- Also drops takumiPayProgramId / takumiPayContractId: both duplicated a
-- SmartContract row (name: "takumi_pay") with no sync guarantee between the
-- two. SmartContract is now the single source of truth for takumi_pay's
-- per-chain contract/program address, matching how EVM's contracts already
-- work.

ALTER TABLE "Blockchain" ADD COLUMN "type" TEXT;

UPDATE "Blockchain" SET "type" = 'EVM' WHERE "isEVM" = true;
UPDATE "Blockchain" SET "type" = 'SVM' WHERE "chainSlug" LIKE 'solana-%';
UPDATE "Blockchain" SET "type" = 'MOVE_VM' WHERE "chainSlug" LIKE 'sui-%';
UPDATE "Blockchain" SET "type" = 'STELLAR' WHERE "chainSlug" LIKE 'stellar-%';

ALTER TABLE "Blockchain" ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE "Blockchain" DROP COLUMN "takumiPayProgramId";
ALTER TABLE "Blockchain" DROP COLUMN "takumiPayContractId";
