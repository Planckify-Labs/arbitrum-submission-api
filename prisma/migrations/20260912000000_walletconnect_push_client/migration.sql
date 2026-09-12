-- WalletConnect push-server registrations (deep-link spec §7.5).
-- One row per wallet install: the relay client id and the Expo push token
-- the app registered for it. Written by POST /walletconnect/push/clients
-- (forwarded by WalletConnect from the wallet's registerDeviceToken call),
-- read by POST /walletconnect/push/clients/:clientId (the relay's delivery).
CREATE TABLE "WalletConnectPushClient" (
    "clientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "alwaysRaw" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletConnectPushClient_pkey" PRIMARY KEY ("clientId")
);

CREATE INDEX "WalletConnectPushClient_token_idx" ON "WalletConnectPushClient"("token");
