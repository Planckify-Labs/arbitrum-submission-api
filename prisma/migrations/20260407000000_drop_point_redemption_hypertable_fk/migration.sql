-- Drop FKs from regular tables to TimescaleDB hypertables.
-- TimescaleDB hypertables cannot be FK targets — their chunks live in
-- _timescaledb_internal, which causes Prisma P4002 introspection errors.
-- Referential integrity is enforced at the application level.

ALTER TABLE "PointRedemption"
    DROP CONSTRAINT IF EXISTS "PointRedemption_pointTransactionId_pointTransactionCreated_fkey";

ALTER TABLE "Purchase"
    DROP CONSTRAINT IF EXISTS "Purchase_transactionId_transactionCreatedAt_fkey";
