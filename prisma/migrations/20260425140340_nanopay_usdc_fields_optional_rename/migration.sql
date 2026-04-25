/*
  Warnings:

  - You are about to drop the column `usdcAmountMicros` on the `PaymentIntent` table. All the data in the column will be lost.
  - You are about to drop the column `usdcSourceChainId` on the `PaymentIntent` table. All the data in the column will be lost.
  - You are about to drop the column `usdcTreasuryAddress` on the `PaymentIntent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PaymentIntent" DROP COLUMN "usdcAmountMicros",
DROP COLUMN "usdcSourceChainId",
DROP COLUMN "usdcTreasuryAddress",
ADD COLUMN     "nanopayUsdcAmountMicros" BIGINT,
ADD COLUMN     "nanopayUsdcSourceChainId" INTEGER,
ADD COLUMN     "nanopayUsdcTreasuryAddress" TEXT;
