-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'EXPIRED', 'EXECUTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BookingOrder" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPriceId" TEXT NOT NULL,
    "payment" JSONB NOT NULL,
    "exchangeRate" JSONB NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "purchaseId" TEXT,

    CONSTRAINT "BookingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingOrder_purchaseId_key" ON "BookingOrder"("purchaseId");

-- CreateIndex
CREATE INDEX "BookingOrder_walletAddress_idx" ON "BookingOrder"("walletAddress");

-- CreateIndex
CREATE INDEX "BookingOrder_status_idx" ON "BookingOrder"("status");

-- AddForeignKey
ALTER TABLE "BookingOrder" ADD CONSTRAINT "BookingOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOrder" ADD CONSTRAINT "BookingOrder_productPriceId_fkey" FOREIGN KEY ("productPriceId") REFERENCES "ProductPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOrder" ADD CONSTRAINT "BookingOrder_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
