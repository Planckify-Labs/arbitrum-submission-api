/*
  Warnings:

  - You are about to drop the column `purchaseId` on the `BookingOrder` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "BookingOrder" DROP CONSTRAINT "BookingOrder_purchaseId_fkey";

-- DropIndex
DROP INDEX "BookingOrder_purchaseId_key";

-- AlterTable
ALTER TABLE "BookingOrder" DROP COLUMN "purchaseId";
