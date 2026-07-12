-- Drops Blockchain.isEVM -- fully redundant with `type` (isEVM was always
-- exactly `type === 'EVM'`; the earlier migration that added `type` already
-- backfilled it directly from this same column). Every code path now reads
-- `type` instead; the public API's `isEVM` boolean field is preserved by
-- computing it from `type` at serialization time (see
-- blockchain-enricher.ts#enrichBlockchain), not by storing it twice.

ALTER TABLE "Blockchain" DROP COLUMN "isEVM";
