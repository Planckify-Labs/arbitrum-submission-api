-- Adds `type` (contract category: "payment" / "gateway" / "protocol" / ...)
-- and `version` (integer, defaults to 1) to SmartContract.
--
-- `type` is backfilled by inferring the category from the existing `name`
-- machine key, since that's the only signal we have for rows seeded before
-- this column existed:
--   - "takumi_pay"                                        -> payment
--   - "gateway_wallet" / "gateway_minter" / "paymaster" /
--     "x402_verifying"                                     -> gateway
--   - everything else (Aave/Curve/Lido/Morpho/... DeFi
--     integrations, Sui intent_receipt audit log)          -> protocol
ALTER TABLE "SmartContract" ADD COLUMN "type" TEXT;
ALTER TABLE "SmartContract" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "SmartContract"
SET "type" = CASE
  WHEN "name" = 'takumi_pay' THEN 'payment'
  WHEN "name" IN ('gateway_wallet', 'gateway_minter', 'paymaster', 'x402_verifying') THEN 'gateway'
  ELSE 'protocol'
END;

ALTER TABLE "SmartContract" ALTER COLUMN "type" SET NOT NULL;
