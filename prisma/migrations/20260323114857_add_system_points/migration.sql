-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('DEPOSIT', 'SPEND', 'REFUND', 'BONUS');

-- CreateEnum
CREATE TYPE "PointTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "PointBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PointTransactionType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "refId" TEXT,
    "txHash" TEXT,
    "tokenId" TEXT,
    "blockchainId" TEXT,
    "contractAddress" TEXT,
    "tokenAmount" DECIMAL(36,18),
    "pointRate" DECIMAL(18,8),
    "referenceType" TEXT,
    "referenceId" TEXT,
    "status" "PointTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointPriceConfig" (
    "id" TEXT NOT NULL,
    "baseRate" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PointPriceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointBalance_userId_key" ON "PointBalance"("userId");

-- CreateIndex
CREATE INDEX "PointBalance_userId_idx" ON "PointBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_refId_key" ON "PointTransaction"("refId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_txHash_key" ON "PointTransaction"("txHash");

-- CreateIndex
CREATE INDEX "PointTransaction_userId_createdAt_idx" ON "PointTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PointTransaction_status_idx" ON "PointTransaction"("status");

-- CreateIndex
CREATE INDEX "PointTransaction_txHash_idx" ON "PointTransaction"("txHash");

-- CreateIndex
CREATE INDEX "PointTransaction_refId_idx" ON "PointTransaction"("refId");

-- CreateIndex
CREATE INDEX "PointPriceConfig_isActive_createdAt_idx" ON "PointPriceConfig"("isActive", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PointPriceConfig_currency_isActive_key" ON "PointPriceConfig"("currency", "isActive");

-- AddForeignKey
ALTER TABLE "PointBalance" ADD CONSTRAINT "PointBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_blockchainId_fkey" FOREIGN KEY ("blockchainId") REFERENCES "Blockchain"("id") ON DELETE SET NULL ON UPDATE CASCADE;
