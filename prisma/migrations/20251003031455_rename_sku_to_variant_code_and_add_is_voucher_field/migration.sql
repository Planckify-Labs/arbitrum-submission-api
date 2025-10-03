/*
  Warnings:

  - You are about to drop the column `sku` on the `ProductVariant` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[variantCode]` on the table `ProductVariant` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `variantCode` to the `ProductVariant` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ProductVariant_sku_idx";

-- DropIndex
DROP INDEX "ProductVariant_sku_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isVoucher" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductVariant" DROP COLUMN "sku",
ADD COLUMN     "variantCode" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_variantCode_key" ON "ProductVariant"("variantCode");

-- CreateIndex
CREATE INDEX "ProductVariant_variantCode_idx" ON "ProductVariant"("variantCode");
