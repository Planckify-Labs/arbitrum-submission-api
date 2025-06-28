-- DropIndex
DROP INDEX "ExchangeRate_createdAt_idx";

-- DropIndex
DROP INDEX "idx_exchange_rate_time_lookup";

-- RenameIndex
ALTER INDEX "ExchangeRate_fromCurrency_toCurrency_region_provider_createdAt_" RENAME TO "ExchangeRate_fromCurrency_toCurrency_region_provider_create_key";
