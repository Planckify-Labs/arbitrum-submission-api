-- CreateEnum
CREATE TYPE "ReferenceIdStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "refId" TEXT;

-- DropEnum
DROP TYPE "ProductInputType";

-- CreateTable
CREATE TABLE "ReferenceId" (
    "id" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" "ReferenceIdStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceId_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceId_refId_key" ON "ReferenceId"("refId");

-- CreateIndex
CREATE INDEX "ReferenceId_refId_idx" ON "ReferenceId"("refId");

-- CreateIndex
CREATE INDEX "ReferenceId_status_idx" ON "ReferenceId"("status");

-- CreateIndex
CREATE INDEX "Purchase_refId_idx" ON "Purchase"("refId");
