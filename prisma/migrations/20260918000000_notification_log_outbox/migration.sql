-- NotificationLog becomes a durable push outbox (see PushService).
-- The row is now written before the Expo send and carries everything the
-- dispatch worker needs to (re)build the message, plus per-device progress
-- so retries never double-send a device Expo already accepted.
--
-- Existing rows keep their current deliveryStatus (pending/delivered/…);
-- the sweeper only ever touches `queued` / `sending`, so nothing historical
-- is re-sent by this migration.
ALTER TABLE "NotificationLog"
    ADD COLUMN "channelId" TEXT,
    ADD COLUMN "imageUrl" TEXT,
    ADD COLUMN "targetDeviceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "pendingDeviceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastError" TEXT,
    ADD COLUMN "expiresAt" TIMESTAMP(3),
    ADD COLUMN "dispatchedAt" TIMESTAMP(3),
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- New rows start life in the outbox.
ALTER TABLE "NotificationLog" ALTER COLUMN "deliveryStatus" SET DEFAULT 'queued';

-- The sweeper's "stuck rows" scan: status + age.
CREATE INDEX "NotificationLog_deliveryStatus_updatedAt_idx"
    ON "NotificationLog"("deliveryStatus", "updatedAt");
