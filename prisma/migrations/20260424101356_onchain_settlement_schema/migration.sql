-- AlterTable
ALTER TABLE "Blockchain" ADD COLUMN     "minConfirmations" INTEGER,
ADD COLUMN     "quoteSignerAddress" TEXT,
ADD COLUMN     "takumiWalletContract" TEXT;

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "merchantBackingAmountMinor" BIGINT,
ADD COLUMN     "platformFeeAmountMinor" BIGINT,
ADD COLUMN     "platformFeeBpsSnapshot" INTEGER,
ADD COLUMN     "quoteSignature" BYTEA,
ADD COLUMN     "sourceTokenId" TEXT;

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "isPaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "platformFeeBps" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OnchainSettlement" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "confirmations" INTEGER,
    "verifiedAt" TIMESTAMPTZ,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnchainSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnchainSettlement_txHash_idx" ON "OnchainSettlement"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "OnchainSettlement_intentId_txHash_key" ON "OnchainSettlement"("intentId", "txHash");

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_sourceTokenId_fkey" FOREIGN KEY ("sourceTokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnchainSettlement" ADD CONSTRAINT "OnchainSettlement_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
