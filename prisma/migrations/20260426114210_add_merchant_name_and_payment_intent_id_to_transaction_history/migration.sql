-- AlterTable
ALTER TABLE "TransactionHistory" ADD COLUMN     "merchantName" TEXT,
ADD COLUMN     "paymentIntentId" TEXT;

-- CreateIndex
CREATE INDEX "TransactionHistory_paymentIntentId_idx" ON "TransactionHistory"("paymentIntentId");
