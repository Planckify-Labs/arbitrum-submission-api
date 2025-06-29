/*
  Warnings:

  - You are about to drop the column `amountInIDR` on the `TransactionHistory` table. All the data in the column will be lost.
  - Added the required column `amountInFiat` to the `TransactionHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fiatCurrency` to the `TransactionHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TransactionHistory" DROP COLUMN "amountInIDR",
ADD COLUMN     "amountInFiat" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "fiatCurrency" TEXT NOT NULL;
