-- CreateTable
CREATE TABLE "WalletAccountLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletAccountLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletAccountLink_userId_idx" ON "WalletAccountLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccountLink_userId_walletAddress_key" ON "WalletAccountLink"("userId", "walletAddress");

-- AddForeignKey
ALTER TABLE "WalletAccountLink" ADD CONSTRAINT "WalletAccountLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

