-- AlterTable
ALTER TABLE "DappCategory" ADD COLUMN     "appearance" JSONB,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Dapp" DROP COLUMN "bgColor",
ADD COLUMN     "appearance" JSONB,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DappPromotion" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "appearance" JSONB,
    "targetUrl" TEXT,
    "dappId" TEXT,
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DappPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DappPromotion_isActive_idx" ON "DappPromotion"("isActive");

-- CreateIndex
CREATE INDEX "DappPromotion_sortOrder_idx" ON "DappPromotion"("sortOrder");

-- CreateIndex
CREATE INDEX "DappPromotion_dappId_idx" ON "DappPromotion"("dappId");

-- CreateIndex
CREATE INDEX "DappCategory_sortOrder_idx" ON "DappCategory"("sortOrder");

-- CreateIndex
CREATE INDEX "Dapp_sortOrder_idx" ON "Dapp"("sortOrder");

-- AddForeignKey
ALTER TABLE "DappPromotion" ADD CONSTRAINT "DappPromotion_dappId_fkey" FOREIGN KEY ("dappId") REFERENCES "Dapp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
