-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('QUOTED', 'SIGNED', 'SETTLED', 'PAID_OUT', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentIntentPath" AS ENUM ('nanopay', 'x402', 'direct_arc');

-- CreateEnum
CREATE TYPE "GaslessMode" AS ENUM ('nanopay', 'arc_native', 'x402_eip3009', 'none');

-- CreateEnum
CREATE TYPE "XenditPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GatewayDepositStatus" AS ENUM ('PENDING_ATTESTATION', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('ewallet', 'bank');

-- CreateEnum
CREATE TYPE "QrisClaimDisputeStatus" AS ENUM ('none', 'open', 'resolved_valid', 'resolved_invalid');

-- DropForeignKey
ALTER TABLE "PointRedemption" DROP CONSTRAINT "PointRedemption_pointTransactionId_fkey";

-- DropIndex
DROP INDEX "BookingOrder_status_idx";

-- DropIndex
DROP INDEX "ExchangeRate_pair_createdAt_idx";

-- DropIndex
DROP INDEX "PointTransaction_createdAt_idx";

-- AlterTable
ALTER TABLE "Blockchain" ADD COLUMN     "gatewayMinterContract" TEXT,
ADD COLUMN     "gatewayWalletContract" TEXT,
ADD COLUMN     "paymasterAddress" TEXT,
ADD COLUMN     "x402DomainName" TEXT,
ADD COLUMN     "x402DomainVersion" TEXT,
ADD COLUMN     "x402FacilitatorUrl" TEXT,
ADD COLUMN     "x402VerifyingContract" TEXT;

-- AlterTable
ALTER TABLE "FlashSale" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PointTransaction" RENAME CONSTRAINT "PointTransaction_new_pkey" TO "PointTransaction_pkey";

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "xenditChannelCode" TEXT NOT NULL,
    "xenditAccountNumber" BYTEA NOT NULL,
    "xenditAccountHolderName" TEXT NOT NULL,
    "qrisPan" TEXT,
    "qrisStickerPhotoKey" TEXT,
    "jwsQr" TEXT NOT NULL,
    "jwsIssuedAt" TIMESTAMPTZ NOT NULL,
    "jwsExpiresAt" TIMESTAMPTZ,
    "payoutProvider" TEXT NOT NULL DEFAULT 'xendit',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "payerUserId" TEXT,
    "merchantId" TEXT NOT NULL,
    "fiatAmountMinor" INTEGER NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "usdcAmountMicros" BIGINT NOT NULL,
    "usdcSourceChainId" INTEGER NOT NULL,
    "usdcTreasuryAddress" TEXT NOT NULL,
    "exchangeRateId" INTEGER NOT NULL,
    "exchangeRateCreatedAt" TIMESTAMPTZ NOT NULL,
    "fxRateSnapshot" DECIMAL(36,18) NOT NULL,
    "fxMarkupSnapshot" DECIMAL(36,18) NOT NULL,
    "fxFromCurrency" TEXT NOT NULL,
    "fxToCurrency" TEXT NOT NULL,
    "fxProvider" TEXT NOT NULL,
    "fxQuotedAt" TIMESTAMPTZ NOT NULL,
    "feesNetworkUsdMicros" INTEGER NOT NULL,
    "feesXenditIdr" INTEGER NOT NULL,
    "feesPlatformBps" INTEGER NOT NULL,
    "path" "PaymentIntentPath" NOT NULL,
    "nanopayNonce" BYTEA NOT NULL,
    "nanopayValidAfter" INTEGER NOT NULL,
    "nanopayValidBefore" INTEGER NOT NULL,
    "gaslessMode" "GaslessMode" NOT NULL,
    "requiresDeposit" BOOLEAN NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'QUOTED',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NanopaySubmission" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "signature" BYTEA NOT NULL,
    "submittedAt" TIMESTAMPTZ NOT NULL,
    "circleSettleTxUuid" UUID,
    "circleSettleResponseReceivedAt" TIMESTAMPTZ,
    "circleSettleNetwork" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,

    CONSTRAINT "NanopaySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XenditPayout" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "xenditPayoutId" TEXT,
    "referenceId" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "accountNumberEncrypted" BYTEA NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "XenditPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "webhookReceivedAt" TIMESTAMPTZ,
    "xenditResponseBody" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "XenditPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayDeposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceChainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "usedCirclePaymaster" BOOLEAN NOT NULL,
    "status" "GatewayDepositStatus" NOT NULL DEFAULT 'PENDING_ATTESTATION',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ,

    CONSTRAINT "GatewayDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "channelCode" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "accountFormat" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "xenditMinAmountIdr" INTEGER,
    "xenditMaxAmountIdr" INTEGER,
    "xenditFeeIdr" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("channelCode","country")
);

-- CreateTable
CREATE TABLE "MerchantQrisClaim" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "qrisPan" TEXT NOT NULL,
    "stickerPhotoKey" TEXT NOT NULL,
    "claimedAt" TIMESTAMPTZ NOT NULL,
    "reviewedAt" TIMESTAMPTZ,
    "disputeStatus" "QrisClaimDisputeStatus" NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MerchantQrisClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_userId_key" ON "Merchant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_nanopayNonce_key" ON "PaymentIntent"("nanopayNonce");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_expiresAt_idx" ON "PaymentIntent"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_merchantId_createdAt_idx" ON "PaymentIntent"("merchantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NanopaySubmission_intentId_idx" ON "NanopaySubmission"("intentId");

-- CreateIndex
CREATE INDEX "XenditPayout_intentId_idx" ON "XenditPayout"("intentId");

-- CreateIndex
CREATE INDEX "GatewayDeposit_userId_status_idx" ON "GatewayDeposit"("userId", "status");

-- CreateIndex
CREATE INDEX "Channel_country_isActive_priority_idx" ON "Channel"("country", "isActive", "priority");

-- CreateIndex
CREATE INDEX "MerchantQrisClaim_qrisPan_idx" ON "MerchantQrisClaim"("qrisPan");

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NanopaySubmission" ADD CONSTRAINT "NanopaySubmission_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XenditPayout" ADD CONSTRAINT "XenditPayout_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayDeposit" ADD CONSTRAINT "GatewayDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantQrisClaim" ADD CONSTRAINT "MerchantQrisClaim_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "PointRedemption_pointTransactionId_pointTransactionCreatedAt_ke" RENAME TO "PointRedemption_pointTransactionId_pointTransactionCreatedA_key";

-- ─────────────────────────────────────────────────────────────────────────
-- Partial unique indexes (§6.6 Indexes)
-- Prisma's schema language cannot express partial predicates, so these
-- are maintained as raw SQL. Both match the spec verbatim.
-- ─────────────────────────────────────────────────────────────────────────

-- First-claim-wins on QRIS PAN — only non-null rows are unique.
CREATE UNIQUE INDEX "Merchant_qrisPan_unique"
  ON "Merchant" ("qrisPan")
  WHERE "qrisPan" IS NOT NULL;

-- Lets multiple in-flight payouts share a NULL xenditPayoutId before Xendit
-- returns its own id, while enforcing uniqueness once one arrives.
CREATE UNIQUE INDEX "XenditPayout_xenditPayoutId_unique"
  ON "XenditPayout" ("xenditPayoutId")
  WHERE "xenditPayoutId" IS NOT NULL;
