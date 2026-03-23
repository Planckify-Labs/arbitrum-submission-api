-- Drop foreign key to BookingOrder
ALTER TABLE "PointRedemption" DROP CONSTRAINT IF EXISTS "PointRedemption_bookingOrderId_fkey";

-- Drop unique constraint on bookingOrderId (also drops the index)
ALTER TABLE "PointRedemption" DROP CONSTRAINT IF EXISTS "PointRedemption_bookingOrderId_key";

-- Remove bookingOrderId column
ALTER TABLE "PointRedemption" DROP COLUMN IF EXISTS "bookingOrderId";

-- Add productPriceId column
ALTER TABLE "PointRedemption" ADD COLUMN "productPriceId" TEXT NOT NULL DEFAULT '';

-- Add customerInfo column
ALTER TABLE "PointRedemption" ADD COLUMN "customerInfo" JSONB;

-- Remove DEFAULT after backfill (column is now just NOT NULL)
ALTER TABLE "PointRedemption" ALTER COLUMN "productPriceId" DROP DEFAULT;

-- Add foreign key to ProductPrice
ALTER TABLE "PointRedemption" ADD CONSTRAINT "PointRedemption_productPriceId_fkey"
  FOREIGN KEY ("productPriceId") REFERENCES "ProductPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
