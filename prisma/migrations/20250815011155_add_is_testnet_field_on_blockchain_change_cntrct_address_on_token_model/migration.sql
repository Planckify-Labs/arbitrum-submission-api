-- AlterTable
ALTER TABLE "Blockchain" ADD COLUMN     "isTestnet" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Token" ALTER COLUMN "contractAddress" DROP NOT NULL;
