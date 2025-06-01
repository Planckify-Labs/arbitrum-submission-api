/*
  Warnings:

  - You are about to drop the column `vendorName` on the `Products` table. All the data in the column will be lost.
  - Added the required column `vendorId` to the `Products` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Products_vendorName_key";

-- AlterTable
ALTER TABLE "Products" DROP COLUMN "vendorName",
ADD COLUMN     "vendorId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendors_name_key" ON "Vendors"("name");

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
