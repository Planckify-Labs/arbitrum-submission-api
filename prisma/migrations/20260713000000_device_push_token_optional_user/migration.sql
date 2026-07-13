-- DevicePushToken.userId becomes optional: devices must be able to
-- register their Expo push token (and wallet subscriptions) before the
-- user has authenticated. The registration endpoint is switching from
-- JWT-required to public + X-API-Key gated, with an optional JWT that
-- fills in userId when the caller happens to already be signed in.

ALTER TABLE "DevicePushToken" ALTER COLUMN "userId" DROP NOT NULL;
