/*
  Warnings:

  - Added the required column `categoryType` to the `Category` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('SUBCATEGORY', 'MAINCATEGORY');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "categoryType" "CategoryType" NOT NULL;
