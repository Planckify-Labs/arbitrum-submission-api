-- Rename PaymentIntent.feesXenditIdr → feesPayoutMinor.
--
-- Why: the column stores a provider-agnostic payout-side fee snapshot;
-- the currency is already on PaymentIntent.fiatCurrency. Dropping the
-- "Xendit" + "Idr" prefixes lets PH/TH/VN expansion happen as data
-- (new Channel rows + a PH provider adapter) without another rename.
--
-- ALTER COLUMN RENAME is metadata-only — zero data movement.
ALTER TABLE "PaymentIntent" RENAME COLUMN "feesXenditIdr" TO "feesPayoutMinor";
