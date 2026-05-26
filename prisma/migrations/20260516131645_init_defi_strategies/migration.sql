-- CreateTable
CREATE TABLE "UserStrategy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "assetPreference" TEXT NOT NULL,
    "liquidityPref" TEXT NOT NULL,
    "chainPref" JSONB NOT NULL,
    "allocationPct" INTEGER NOT NULL,
    "rebalanceTrigger" JSONB NOT NULL,
    "protocolWhitelist" TEXT[],
    "allowAllInTier" BOOLEAN NOT NULL DEFAULT false,
    "notificationLevel" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyPosition" (
    "id" TEXT NOT NULL,
    "userStrategyId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "namespace" TEXT NOT NULL,
    "protocolSlug" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "assetContract" TEXT,
    "amountAtDeposit" TEXT NOT NULL,
    "amountAtDepositUsd" DECIMAL(65,30) NOT NULL,
    "currentAmountRaw" TEXT,
    "currentAmountUsd" DECIMAL(65,30),
    "status" TEXT NOT NULL,
    "openTxHash" TEXT,
    "closeTxHash" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "goal" TEXT,
    "targetDate" TIMESTAMP(3),

    CONSTRAINT "StrategyPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityCache" (
    "id" TEXT NOT NULL,
    "protocolSlug" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "namespace" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "apy" DECIMAL(65,30) NOT NULL,
    "apy7dAvg" DECIMAL(65,30) NOT NULL,
    "apyStddev30d" DECIMAL(65,30) NOT NULL,
    "tvlUsd" DECIMAL(65,30) NOT NULL,
    "tvl7dDelta" DECIMAL(65,30) NOT NULL,
    "emissionsToFeesRatio" DECIMAL(65,30),
    "ilExposure" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolScoreCache" (
    "protocolSlug" TEXT NOT NULL,
    "safetyScore" INTEGER NOT NULL,
    "auditCount" INTEGER NOT NULL,
    "protocolAgeDays" INTEGER NOT NULL,
    "exploitHistoryFlag" BOOLEAN NOT NULL,
    "tvlTrendBps" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolScoreCache_pkey" PRIMARY KEY ("protocolSlug")
);

-- CreateIndex
CREATE INDEX "UserStrategy_userId_idx" ON "UserStrategy"("userId");

-- CreateIndex
CREATE INDEX "UserStrategy_walletAddress_idx" ON "UserStrategy"("walletAddress");

-- CreateIndex
CREATE INDEX "StrategyPosition_walletAddress_status_idx" ON "StrategyPosition"("walletAddress", "status");

-- CreateIndex
CREATE INDEX "StrategyPosition_targetDate_idx" ON "StrategyPosition"("targetDate");

-- CreateIndex
CREATE INDEX "OpportunityCache_tier_score_idx" ON "OpportunityCache"("tier", "score");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityCache_poolId_key" ON "OpportunityCache"("poolId");

-- AddForeignKey
ALTER TABLE "StrategyPosition" ADD CONSTRAINT "StrategyPosition_userStrategyId_fkey" FOREIGN KEY ("userStrategyId") REFERENCES "UserStrategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
