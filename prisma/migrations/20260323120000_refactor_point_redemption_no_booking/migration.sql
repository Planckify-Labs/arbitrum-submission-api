-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "PointRedemption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointTransactionId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "productPriceId" TEXT NOT NULL,
    "customerInfo" JSONB,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "pointsSpent" BIGINT NOT NULL,
    "vendorResponse" JSONB,
    "vendorRefId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointRedemption_pointTransactionId_key" ON "PointRedemption"("pointTransactionId");

-- CreateIndex
CREATE INDEX "PointRedemption_userId_idx" ON "PointRedemption"("userId");

-- CreateIndex
CREATE INDEX "PointRedemption_status_idx" ON "PointRedemption"("status");

-- CreateIndex
CREATE INDEX "PointRedemption_createdAt_idx" ON "PointRedemption"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "PointRedemption" ADD CONSTRAINT "PointRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRedemption" ADD CONSTRAINT "PointRedemption_pointTransactionId_fkey" FOREIGN KEY ("pointTransactionId") REFERENCES "PointTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRedemption" ADD CONSTRAINT "PointRedemption_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRedemption" ADD CONSTRAINT "PointRedemption_productPriceId_fkey" FOREIGN KEY ("productPriceId") REFERENCES "ProductPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
