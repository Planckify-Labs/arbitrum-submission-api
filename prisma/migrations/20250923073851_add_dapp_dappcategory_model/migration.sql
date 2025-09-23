-- CreateTable
CREATE TABLE "DappCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DappCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dapp" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "websiteUrl" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isSponsor" BOOLEAN NOT NULL DEFAULT false,
    "isHighlight" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDappFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dappId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDappFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DappCategory_name_key" ON "DappCategory"("name");

-- CreateIndex
CREATE INDEX "DappCategory_name_idx" ON "DappCategory"("name");

-- CreateIndex
CREATE INDEX "DappCategory_isActive_idx" ON "DappCategory"("isActive");

-- CreateIndex
CREATE INDEX "Dapp_categoryId_idx" ON "Dapp"("categoryId");

-- CreateIndex
CREATE INDEX "Dapp_isPopular_idx" ON "Dapp"("isPopular");

-- CreateIndex
CREATE INDEX "Dapp_isSponsor_idx" ON "Dapp"("isSponsor");

-- CreateIndex
CREATE INDEX "Dapp_isHighlight_idx" ON "Dapp"("isHighlight");

-- CreateIndex
CREATE INDEX "Dapp_isActive_idx" ON "Dapp"("isActive");

-- CreateIndex
CREATE INDEX "Dapp_createdAt_idx" ON "Dapp"("createdAt");

-- CreateIndex
CREATE INDEX "UserDappFavorite_userId_idx" ON "UserDappFavorite"("userId");

-- CreateIndex
CREATE INDEX "UserDappFavorite_dappId_idx" ON "UserDappFavorite"("dappId");

-- CreateIndex
CREATE UNIQUE INDEX "UserDappFavorite_userId_dappId_key" ON "UserDappFavorite"("userId", "dappId");

-- AddForeignKey
ALTER TABLE "Dapp" ADD CONSTRAINT "Dapp_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DappCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDappFavorite" ADD CONSTRAINT "UserDappFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDappFavorite" ADD CONSTRAINT "UserDappFavorite_dappId_fkey" FOREIGN KEY ("dappId") REFERENCES "Dapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
