-- AlterTable
ALTER TABLE "Blockchain" ADD COLUMN     "solanaCluster" TEXT,
ADD COLUMN     "takumiPayProgramId" TEXT;

-- AlterTable
ALTER TABLE "OnchainSettlement" ADD COLUMN     "cluster" TEXT,
ALTER COLUMN "chainId" DROP NOT NULL;
