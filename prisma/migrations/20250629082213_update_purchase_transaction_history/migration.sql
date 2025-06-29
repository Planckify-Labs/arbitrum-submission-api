/*
  Warnings:

  - You are about to drop the column `purchaseId` on the `ApiRequestLog` table. All the data in the column will be lost.
  - You are about to drop the column `customerInfo` on the `Purchase` table. All the data in the column will be lost.
  - You are about to drop the column `fromAddress` on the `TransactionHistory` table. All the data in the column will be lost.
  - You are about to drop the column `toAddress` on the `TransactionHistory` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'TRANSFERRED';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'TRANSFER';

-- DropForeignKey
ALTER TABLE "ApiRequestLog" DROP CONSTRAINT "ApiRequestLog_purchaseId_fkey";

-- AlterTable
ALTER TABLE "ApiRequestLog" DROP COLUMN "purchaseId";

-- AlterTable
ALTER TABLE "Purchase" DROP COLUMN "customerInfo";

-- AlterTable
ALTER TABLE "TransactionHistory" DROP COLUMN "fromAddress",
DROP COLUMN "toAddress",
ADD COLUMN     "recipientAddress" TEXT,
ADD COLUMN     "senderAddress" TEXT;
