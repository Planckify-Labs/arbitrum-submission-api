-- CreateEnum
CREATE TYPE "ProductInputType" AS ENUM ('TEXT', 'NUMBER');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "inputDescription" TEXT,
ADD COLUMN     "inputType" "ProductInputType";
