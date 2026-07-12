-- Consolidates Circle Gateway / Paymaster contract addresses into
-- SmartContract (name: "gateway_wallet" / "gateway_minter" / "paymaster"),
-- the same per-chain contract registry takumi_pay already uses -- fixing a
-- real duplication bug: gatewayWalletContract and x402VerifyingContract held
-- the identical address on Arc with no sync guarantee between the two
-- columns (Circle's Gateway wallet contract *is* the x402 EIP-712 verifying
-- contract by protocol design, not a coincidence -- one row now covers both
-- roles; see blockchain-enricher.ts#buildX402 for the fallback lookup).
--
-- x402DomainName / x402DomainVersion / x402FacilitatorUrl (genuine per-chain
-- config, not addresses) move into a new `metadata` JSONB column.

ALTER TABLE "Blockchain" ADD COLUMN "metadata" JSONB;

UPDATE "Blockchain"
SET "metadata" = jsonb_strip_nulls(jsonb_build_object(
  'x402DomainName', "x402DomainName",
  'x402DomainVersion', "x402DomainVersion",
  'x402FacilitatorUrl', "x402FacilitatorUrl"
))
WHERE "x402DomainName" IS NOT NULL
   OR "x402DomainVersion" IS NOT NULL
   OR "x402FacilitatorUrl" IS NOT NULL;

INSERT INTO "SmartContract" (id, name, "blockchainId", address, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'gateway_wallet', id, "gatewayWalletContract", true, now(), now()
FROM "Blockchain" WHERE "gatewayWalletContract" IS NOT NULL;

INSERT INTO "SmartContract" (id, name, "blockchainId", address, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'gateway_minter', id, "gatewayMinterContract", true, now(), now()
FROM "Blockchain" WHERE "gatewayMinterContract" IS NOT NULL;

INSERT INTO "SmartContract" (id, name, "blockchainId", address, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'paymaster', id, "paymasterAddress", true, now(), now()
FROM "Blockchain" WHERE "paymasterAddress" IS NOT NULL;

-- Only insert a distinct "x402_verifying" row where the address genuinely
-- differs from gatewayWalletContract -- otherwise the "gateway_wallet" row
-- above already covers it (and the unique (blockchainId, address) index
-- would reject a duplicate-address insert under a different name anyway).
INSERT INTO "SmartContract" (id, name, "blockchainId", address, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'x402_verifying', id, "x402VerifyingContract", true, now(), now()
FROM "Blockchain"
WHERE "x402VerifyingContract" IS NOT NULL
  AND "x402VerifyingContract" IS DISTINCT FROM "gatewayWalletContract";

ALTER TABLE "Blockchain" DROP COLUMN "gatewayWalletContract";
ALTER TABLE "Blockchain" DROP COLUMN "gatewayMinterContract";
ALTER TABLE "Blockchain" DROP COLUMN "paymasterAddress";
ALTER TABLE "Blockchain" DROP COLUMN "x402DomainName";
ALTER TABLE "Blockchain" DROP COLUMN "x402DomainVersion";
ALTER TABLE "Blockchain" DROP COLUMN "x402VerifyingContract";
ALTER TABLE "Blockchain" DROP COLUMN "x402FacilitatorUrl";
