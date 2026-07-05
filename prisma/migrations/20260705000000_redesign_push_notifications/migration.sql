-- Migration: redesign push notifications
-- Replaces the single PushToken table with:
--   DevicePushToken       — one row per device install
--   WalletPushSubscription — one row per (device, wallet address) pair
--   NotificationLog       — audit trail for sent pushes
--
-- Data migration: existing PushToken rows are carried forward.
-- walletAddress rows become WalletPushSubscription rows (no namespace stored —
-- address format is chain-agnostic by design).

-- CreateTable DevicePushToken
CREATE TABLE "DevicePushToken" (
    "id"           TEXT NOT NULL,
    "token"        TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "platform"     TEXT NOT NULL,
    "lastPushedAt" TIMESTAMP(3),
    "failCount"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DevicePushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DevicePushToken_token_key" ON "DevicePushToken"("token");
CREATE INDEX "DevicePushToken_userId_idx" ON "DevicePushToken"("userId");

-- CreateTable WalletPushSubscription
CREATE TABLE "WalletPushSubscription" (
    "id"            TEXT NOT NULL,
    "deviceTokenId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletPushSubscription_deviceTokenId_walletAddress_key"
    ON "WalletPushSubscription"("deviceTokenId", "walletAddress");
CREATE INDEX "WalletPushSubscription_walletAddress_idx" ON "WalletPushSubscription"("walletAddress");

-- CreateTable NotificationLog
CREATE TABLE "NotificationLog" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT,
    "walletAddress"  TEXT,
    "title"          TEXT NOT NULL,
    "body"           TEXT NOT NULL,
    "data"           JSONB,
    "source"         TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationLog_userId_idx"        ON "NotificationLog"("userId");
CREATE INDEX "NotificationLog_walletAddress_idx" ON "NotificationLog"("walletAddress");
CREATE INDEX "NotificationLog_sentAt_idx"         ON "NotificationLog"("sentAt");

-- Migrate existing PushToken rows → DevicePushToken
INSERT INTO "DevicePushToken" ("id", "token", "userId", "platform", "createdAt", "updatedAt")
SELECT
    concat('m', replace(gen_random_uuid()::text, '-', '')),
    token,
    "userId",
    platform,
    "createdAt",
    "updatedAt"
FROM "PushToken";

-- Migrate wallet subscriptions: PushToken rows with a walletAddress
-- become WalletPushSubscription rows linked to the new DevicePushToken.
INSERT INTO "WalletPushSubscription" ("id", "deviceTokenId", "walletAddress", "createdAt")
SELECT
    concat('m', replace(gen_random_uuid()::text, '-', '')),
    dpt.id,
    pt."walletAddress",
    pt."createdAt"
FROM "PushToken" pt
JOIN "DevicePushToken" dpt ON dpt.token = pt.token
WHERE pt."walletAddress" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "DevicePushToken"
    ADD CONSTRAINT "DevicePushToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WalletPushSubscription"
    ADD CONSTRAINT "WalletPushSubscription_deviceTokenId_fkey"
    FOREIGN KEY ("deviceTokenId") REFERENCES "DevicePushToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable
DROP TABLE "PushToken";
