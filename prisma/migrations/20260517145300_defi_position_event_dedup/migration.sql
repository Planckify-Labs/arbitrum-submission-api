-- CreateTable
CREATE TABLE "StrategyPositionEvent" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyPositionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategyPositionEvent_positionId_kind_key" ON "StrategyPositionEvent"("positionId", "kind");

-- CreateIndex
CREATE INDEX "StrategyPositionEvent_positionId_idx" ON "StrategyPositionEvent"("positionId");
