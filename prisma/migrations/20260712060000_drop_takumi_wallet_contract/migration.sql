-- Drops Blockchain.takumiWalletContract -- it was NULL on every row (never
-- actually populated by ops or seed) and duplicated the address already
-- tracked as a "Payment Processor" SmartContract row on the real EVM chains
-- that have one, same pattern already fixed for Solana/Stellar/Gateway.
--
-- Renames existing "Payment Processor" / "Payment Processor Sepolia"
-- SmartContract rows to the same canonical "takumi_pay" name used by every
-- other chain family, so BlockchainVerificationService /
-- OnchainSettlementProvider can look it up the same way everywhere.

UPDATE "SmartContract" SET name = 'takumi_pay' WHERE name IN ('Payment Processor', 'Payment Processor Sepolia');

ALTER TABLE "Blockchain" DROP COLUMN "takumiWalletContract";
