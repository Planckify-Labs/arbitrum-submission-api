-- Notification centre: categories + per-user preferences, inbox read marker,
-- and a producer-agnostic dedupe key so the same on-chain event reported by
-- two sources (sender's app POST, Zerion webhook) is one notification.
ALTER TABLE "NotificationLog"
    ADD COLUMN "category" TEXT,
    ADD COLUMN "dedupeKey" TEXT,
    ADD COLUMN "readAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");
CREATE INDEX "NotificationLog_userId_sentAt_idx" ON "NotificationLog"("userId", "sentAt" DESC);
CREATE INDEX "NotificationLog_walletAddress_sentAt_idx" ON "NotificationLog"("walletAddress", "sentAt" DESC);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '{}',
    "digestHourUtc" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
