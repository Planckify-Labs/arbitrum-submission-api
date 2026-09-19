-- Fulfilment leg: separate "vendor accepted the order" from "vendor handed
-- the product over", structured delivery payloads, a points-refund ledger
-- for orders the vendor could not fulfil, and a log of voucher_code shapes
-- per product so ops can write parser templates for the long tail.

CREATE TYPE "FulfilmentStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'DELAYED', 'DELIVERED', 'FAILED', 'NEEDS_RECONCILE', 'REFUNDED');
CREATE TYPE "DeliveryType" AS ENUM ('VOUCHER_CODE', 'DIRECT_TOPUP', 'BILL_PAYMENT', 'EMAIL');
CREATE TYPE "FulfilmentRefundStatus" AS ENUM ('PENDING_REVIEW', 'COMPLETED', 'REJECTED', 'REVERSED');
ALTER TYPE "PointTransactionType" ADD VALUE 'ADJUSTMENT';

-- Product / variant metadata ---------------------------------------------
ALTER TABLE "Product"
    ADD COLUMN "deliveryType" "DeliveryType",
    ADD COLUMN "voucherTemplate" JSONB;

ALTER TABLE "ProductVariant"
    ADD COLUMN "slaSeconds" INTEGER;

-- Purchase ----------------------------------------------------------------
ALTER TABLE "Purchase"
    ADD COLUMN "fulfilmentStatus" "FulfilmentStatus" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN "fulfilmentError" TEXT,
    ADD COLUMN "delivery" JSONB,
    ADD COLUMN "deliveryRaw" TEXT,
    ADD COLUMN "expectedBy" TIMESTAMP(3),
    ADD COLUMN "fulfilledAt" TIMESTAMP(3),
    ADD COLUMN "vendorLastCheckedAt" TIMESTAMP(3),
    ADD COLUMN "vendorCheckCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "deliveredAfterRefundAt" TIMESTAMP(3);

CREATE INDEX "Purchase_fulfilmentStatus_updatedAt_idx" ON "Purchase"("fulfilmentStatus", "updatedAt");

-- Backfill from the money leg + whatever vendor status was cached by the
-- lazy fetch. COMPLETED rows with a cached final status are DELIVERED;
-- the rest of the COMPLETED rows are SUBMITTED so the sweeper resolves the
-- recent ones and ops can see the old ones. `voucher_code` is copied into
-- deliveryRaw so the backfill script can parse it later.
UPDATE "Purchase" SET
    "fulfilmentStatus" = CASE
        WHEN "status" = 'FAILED' THEN 'FAILED'::"FulfilmentStatus"
        WHEN "status" = 'REFUNDED' THEN 'REFUNDED'::"FulfilmentStatus"
        WHEN "status" = 'COMPLETED'
             AND ("vendorStatusResponse"->'vendorStatusResponse'->'data'->>'status') = '2'
            THEN 'DELIVERED'::"FulfilmentStatus"
        WHEN "status" = 'COMPLETED' THEN 'SUBMITTED'::"FulfilmentStatus"
        ELSE 'QUEUED'::"FulfilmentStatus"
    END,
    "deliveryRaw" = NULLIF("vendorStatusResponse"->'vendorStatusResponse'->'data'->'detail'->>'voucher_code', ''),
    "fulfilledAt" = CASE
        WHEN "status" = 'COMPLETED'
             AND ("vendorStatusResponse"->'vendorStatusResponse'->'data'->>'status') = '2'
            THEN "updatedAt"
        ELSE NULL
    END;

-- PointRedemption ---------------------------------------------------------
ALTER TABLE "PointRedemption"
    ADD COLUMN "fulfilmentStatus" "FulfilmentStatus" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN "fulfilmentError" TEXT,
    ADD COLUMN "delivery" JSONB,
    ADD COLUMN "deliveryRaw" TEXT,
    ADD COLUMN "expectedBy" TIMESTAMP(3),
    ADD COLUMN "fulfilledAt" TIMESTAMP(3),
    ADD COLUMN "vendorLastCheckedAt" TIMESTAMP(3),
    ADD COLUMN "vendorCheckCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "deliveredAfterRefundAt" TIMESTAMP(3);

CREATE INDEX "PointRedemption_fulfilmentStatus_updatedAt_idx" ON "PointRedemption"("fulfilmentStatus", "updatedAt");

-- The redeem path caches the order-status body directly (no wrapper).
UPDATE "PointRedemption" SET
    "fulfilmentStatus" = CASE
        WHEN "status" = 'FAILED' THEN 'FAILED'::"FulfilmentStatus"
        WHEN "status" = 'REFUNDED' THEN 'REFUNDED'::"FulfilmentStatus"
        WHEN "status" = 'COMPLETED'
             AND ("vendorResponse"->'data'->>'status') = '2'
            THEN 'DELIVERED'::"FulfilmentStatus"
        WHEN "status" = 'COMPLETED' THEN 'SUBMITTED'::"FulfilmentStatus"
        ELSE 'QUEUED'::"FulfilmentStatus"
    END,
    "deliveryRaw" = NULLIF("vendorResponse"->'data'->'detail'->>'voucher_code', ''),
    "fulfilledAt" = CASE
        WHEN "status" = 'COMPLETED' AND ("vendorResponse"->'data'->>'status') = '2'
            THEN "updatedAt"
        ELSE NULL
    END;

-- Refund ledger -----------------------------------------------------------
-- The balance movement is a PointTransaction (hypertable) — referenced by
-- (id, createdAt) columns only, never a FK.
CREATE TABLE "FulfilmentRefund" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "redemptionId" TEXT,
    "userId" TEXT NOT NULL,
    "points" BIGINT NOT NULL,
    "fiatAmount" DECIMAL(18,2),
    "currency" TEXT,
    "status" "FulfilmentRefundStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "vendorError" TEXT,
    "holdReason" TEXT,
    "productCode" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "pointTransactionId" TEXT,
    "pointTransactionCreatedAt" TIMESTAMP(3),
    "reversalPointTransactionId" TEXT,
    "reversalPointTransactionCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfilmentRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FulfilmentRefund_purchaseId_key" ON "FulfilmentRefund"("purchaseId");
CREATE UNIQUE INDEX "FulfilmentRefund_redemptionId_key" ON "FulfilmentRefund"("redemptionId");
CREATE INDEX "FulfilmentRefund_status_createdAt_idx" ON "FulfilmentRefund"("status", "createdAt" DESC);
CREATE INDEX "FulfilmentRefund_userId_createdAt_idx" ON "FulfilmentRefund"("userId", "createdAt" DESC);

ALTER TABLE "FulfilmentRefund"
    ADD CONSTRAINT "FulfilmentRefund_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FulfilmentRefund"
    ADD CONSTRAINT "FulfilmentRefund_redemptionId_fkey"
    FOREIGN KEY ("redemptionId") REFERENCES "PointRedemption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FulfilmentRefund"
    ADD CONSTRAINT "FulfilmentRefund_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Voucher shape log -------------------------------------------------------
CREATE TABLE "VoucherShape" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "parseTier" TEXT NOT NULL,
    "sampleMasked" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherShape_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoucherShape_productCode_signature_key" ON "VoucherShape"("productCode", "signature");
CREATE INDEX "VoucherShape_parseTier_lastSeenAt_idx" ON "VoucherShape"("parseTier", "lastSeenAt" DESC);
