/*
  Warnings:

  - Added the required column `currency` to the `ProductPrice` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProductPrice" ADD COLUMN     "currency" TEXT NOT NULL;
