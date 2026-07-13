-- Track whether a dispatched push notification was actually delivered.
-- An "ok" Expo ticket at send time only means Expo accepted the request;
-- real delivery status is only known once PushReceiptProcessor checks
-- Expo's receipts endpoint (~20 min later) and writes the result back.

ALTER TABLE "NotificationLog" ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "NotificationLog" ADD COLUMN "expoTicketIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "NotificationLog" ADD COLUMN "deliveryCheckedAt" TIMESTAMP(3);

CREATE INDEX "NotificationLog_deliveryStatus_idx" ON "NotificationLog"("deliveryStatus");
