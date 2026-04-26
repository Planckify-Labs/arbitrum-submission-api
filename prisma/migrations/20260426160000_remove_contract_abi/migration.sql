-- DropForeignKey
ALTER TABLE "SmartContract" DROP CONSTRAINT IF EXISTS "SmartContract_abiId_fkey";

-- AlterTable
ALTER TABLE "SmartContract" DROP COLUMN IF EXISTS "abiId";

-- DropTable
DROP TABLE IF EXISTS "ContractABI";
