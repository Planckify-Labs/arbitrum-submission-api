/*
  Warnings:

  - You are about to drop the column `vendorName` on the `Category` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[vendorName]` on the table `Products` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `vendorName` to the `Products` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Category_vendorName_key";

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "vendorName";

-- AlterTable
ALTER TABLE "Products" ADD COLUMN     "vendorName" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Products_vendorName_key" ON "Products"("vendorName");
