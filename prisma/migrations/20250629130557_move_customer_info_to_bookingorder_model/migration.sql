/*
  Warnings:

  - You are about to drop the column `customerInfo` on the `Purchase` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BookingOrder" ADD COLUMN     "customerInfo" JSONB;

-- AlterTable
ALTER TABLE "Purchase" DROP COLUMN "customerInfo";
