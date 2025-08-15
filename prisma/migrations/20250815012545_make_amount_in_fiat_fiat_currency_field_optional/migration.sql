-- AlterTable
ALTER TABLE "TransactionHistory" ALTER COLUMN "amountInFiat" DROP NOT NULL,
ALTER COLUMN "fiatCurrency" DROP NOT NULL;
