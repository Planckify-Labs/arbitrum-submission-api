-- CreateEnum
CREATE TYPE "InputFieldType" AS ENUM ('TEXT', 'NUMBER', 'EMAIL', 'OPTION', 'DATE');

-- CreateTable
CREATE TABLE "ProductInputField" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "InputFieldType" NOT NULL,
    "alias" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductInputField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductInputField_productId_key_key" ON "ProductInputField"("productId", "key");

-- AddForeignKey
ALTER TABLE "ProductInputField" ADD CONSTRAINT "ProductInputField_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
