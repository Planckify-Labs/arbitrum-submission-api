-- CreateEnum
CREATE TYPE "NftTokenType" AS ENUM ('ERC721', 'ERC1155');

-- CreateTable
CREATE TABLE "NftAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "tokenType" "NftTokenType" NOT NULL DEFAULT 'ERC721',
    "name" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "tokenUri" TEXT,
    "attributes" JSONB,
    "isOwned" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NftAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NftAsset_walletAddress_contractAddress_tokenId_chainId_key" ON "NftAsset"("walletAddress", "contractAddress", "tokenId", "chainId");

-- CreateIndex
CREATE INDEX "NftAsset_userId_isOwned_idx" ON "NftAsset"("userId", "isOwned");

-- CreateIndex
CREATE INDEX "NftAsset_contractAddress_idx" ON "NftAsset"("contractAddress");

-- AddForeignKey
ALTER TABLE "NftAsset" ADD CONSTRAINT "NftAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
