-- CreateTable: FlashSale
-- Supports both purchase and point-redemption flows for time-limited discounts

CREATE TABLE "FlashSale" (
    "id"                 TEXT NOT NULL,
    "productVariantId"   TEXT NOT NULL,
    "productPriceId"     TEXT NOT NULL,
    "discountedPrice"    DECIMAL(18,2) NOT NULL,
    "currency"           TEXT NOT NULL,
    "startsAt"           TIMESTAMP(3) NOT NULL,
    "endsAt"             TIMESTAMP(3) NOT NULL,
    "maxRedemptions"     INTEGER,
    "currentRedemptions" INTEGER NOT NULL DEFAULT 0,
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlashSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlashSale_isActive_startsAt_endsAt_idx" ON "FlashSale"("isActive", "startsAt", "endsAt");
CREATE INDEX "FlashSale_productVariantId_idx" ON "FlashSale"("productVariantId");

-- AddForeignKey
ALTER TABLE "FlashSale" ADD CONSTRAINT "FlashSale_productVariantId_fkey"
    FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlashSale" ADD CONSTRAINT "FlashSale_productPriceId_fkey"
    FOREIGN KEY ("productPriceId") REFERENCES "ProductPrice"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
