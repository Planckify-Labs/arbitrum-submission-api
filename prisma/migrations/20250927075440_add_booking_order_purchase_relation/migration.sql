/*
  Warnings:

  - A unique constraint covering the columns `[bookingOrderId]` on the table `Purchase` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `bookingOrderId` to the `Purchase` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "bookingOrderId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_bookingOrderId_key" ON "Purchase"("bookingOrderId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_bookingOrderId_fkey" FOREIGN KEY ("bookingOrderId") REFERENCES "BookingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
