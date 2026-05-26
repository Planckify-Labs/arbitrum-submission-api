-- Multi-select asset preferences: replace scalar `assetPreference` with `assetPreferences` TEXT[].
-- Existing rows are backfilled as a single-element array preserving their prior value.

ALTER TABLE "UserStrategy"
  ADD COLUMN "assetPreferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "UserStrategy"
  SET "assetPreferences" = ARRAY["assetPreference"]
  WHERE "assetPreference" IS NOT NULL;

ALTER TABLE "UserStrategy" DROP COLUMN "assetPreference";

ALTER TABLE "UserStrategy" ALTER COLUMN "assetPreferences" DROP DEFAULT;
