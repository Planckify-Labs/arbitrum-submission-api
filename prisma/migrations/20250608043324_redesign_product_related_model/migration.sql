/*
  Warnings:

  - You are about to drop the column `productId` on the `BookingOrder` table. All the data in the column will be lost.
  - You are about to drop the column `vendorId` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `productId` on the `ProductPrice` table. All the data in the column will be lost.
  - You are about to drop the column `productId` on the `Purchase` table. All the data in the column will be lost.
  - You are about to drop the column `productPriceId` on the `Purchase` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[contractAddress]` on the table `Token` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `productVariantId` to the `BookingOrder` table without a default value. This is not possible if the table is not empty.
  - Made the column `purchaseId` on table `BookingOrder` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `productVariantId` to the `ProductPrice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `productVariantId` to the `Purchase` table without a default value. This is not possible if the table is not empty.
  - Made the column `contractAddress` on table `Token` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "BookingOrder" DROP CONSTRAINT "BookingOrder_productId_fkey";

-- DropForeignKey
ALTER TABLE "BookingOrder" DROP CONSTRAINT "BookingOrder_purchaseId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "ProductPrice" DROP CONSTRAINT "ProductPrice_productId_fkey";

-- DropForeignKey
ALTER TABLE "Purchase" DROP CONSTRAINT "Purchase_productId_fkey";

-- DropForeignKey
ALTER TABLE "Purchase" DROP CONSTRAINT "Purchase_productPriceId_fkey";

-- DropIndex
DROP INDEX "Token_blockchainId_symbol_key";

-- AlterTable
ALTER TABLE "BookingOrder" DROP COLUMN "productId",
ADD COLUMN     "productVariantId" TEXT NOT NULL,
ALTER COLUMN "purchaseId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "vendorId";

-- AlterTable
ALTER TABLE "ProductPrice" DROP COLUMN "productId",
ADD COLUMN     "productVariantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Purchase" DROP COLUMN "productId",
DROP COLUMN "productPriceId",
ADD COLUMN     "productVariantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "isNativeCurrency" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "contractAddress" SET NOT NULL;

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_sku_idx" ON "ProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Token_contractAddress_key" ON "Token"("contractAddress");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOrder" ADD CONSTRAINT "BookingOrder_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOrder" ADD CONSTRAINT "BookingOrder_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
