/*
  Warnings:

  - You are about to drop the column `inputDescription` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `inputType` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `alias` on the `ProductInputField` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `ProductInputField` table. All the data in the column will be lost.
  - You are about to drop the column `isRequired` on the `ProductInputField` table. All the data in the column will be lost.
  - You are about to drop the column `key` on the `ProductInputField` table. All the data in the column will be lost.
  - You are about to drop the column `options` on the `ProductInputField` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `ProductInputField` table. All the data in the column will be lost.
  - Added the required column `forms` to the `ProductInputField` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ProductInputField_productId_key_key";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "inputDescription",
DROP COLUMN "inputType";

-- AlterTable
ALTER TABLE "ProductInputField" DROP COLUMN "alias",
DROP COLUMN "description",
DROP COLUMN "isRequired",
DROP COLUMN "key",
DROP COLUMN "options",
DROP COLUMN "type",
ADD COLUMN     "forms" JSONB NOT NULL;
