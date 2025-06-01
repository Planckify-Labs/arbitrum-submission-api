/*
  Warnings:

  - You are about to drop the column `vendorId` on the `Category` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[vendorName]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `vendorName` to the `Category` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Category_name_key";

-- DropIndex
DROP INDEX "Category_vendorId_key";

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "vendorId",
ADD COLUMN     "vendorName" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_vendorName_key" ON "Category"("vendorName");

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
