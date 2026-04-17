-- Make Blockchain.chainId nullable. Non-EVM chains (e.g. Solana) have no EIP-155 chainId
-- and are keyed by chainSlug instead. The prior chain-agnostic migration added chainSlug
-- but did not drop the NOT NULL on chainId, causing null-constraint violations when
-- upserting non-EVM blockchains.

ALTER TABLE "Blockchain" ALTER COLUMN "chainId" DROP NOT NULL;
