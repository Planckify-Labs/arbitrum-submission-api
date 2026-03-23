-- DropIndex
DROP INDEX "AdminAuditLog_createdAt_idx";

-- DropIndex
DROP INDEX "AdminAuditLog_id_idx";

-- DropIndex
DROP INDEX "TransactionHistory_createdAt_idx";

-- DropIndex
DROP INDEX "TransactionHistory_id_idx";

-- DropIndex
DROP INDEX "TransactionHistory_type_createdAt_idx";

-- AlterTable
ALTER TABLE "AdminAuditLog" RENAME CONSTRAINT "AdminAuditLog_new_pkey" TO "AdminAuditLog_pkey";

-- AlterTable
ALTER TABLE "TransactionHistory" RENAME CONSTRAINT "TransactionHistory_new_pkey" TO "TransactionHistory_pkey";

-- DropIndex (partial index with WHERE clause, replacing with regular index)
DROP INDEX "TransactionHistory_txHash_idx";

-- CreateIndex (regular index without WHERE clause)
CREATE INDEX "TransactionHistory_txHash_idx" ON "TransactionHistory"("txHash");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_transactionId_transactionCreatedAt_fkey" FOREIGN KEY ("transactionId", "transactionCreatedAt") REFERENCES "TransactionHistory"("id", "createdAt") ON DELETE RESTRICT ON UPDATE CASCADE;
