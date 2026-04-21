/**
 * DI token for the Circle x402 supported HTTP client. Using a string token
 * lets tests inject a mock via `{ provide: X402_HTTP_CLIENT, useValue: … }`
 * without touching the real `fetch`.
 */
export const X402_HTTP_CLIENT = "X402_HTTP_CLIENT";

/**
 * Default URL — testnet. Prod env overrides via `CIRCLE_X402_SUPPORTED_URL`.
 * Spec §6.5 locks the path.
 */
export const DEFAULT_CIRCLE_X402_SUPPORTED_URL =
  "https://gateway-api-testnet.circle.com/gateway/v1/x402/supported";

/** Valkey key for the persisted snapshot. */
export const X402_CACHE_KEY = "x402:supported";

/** 24 h TTL on the Valkey copy — cron refreshes at 12 h so we overwrite
 *  well before expiry. The TTL is a safety net for "cron died silently." */
export const X402_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** 12 h refresh cadence. Circle's supported list rotates rarely (days/weeks)
 *  so aggressive polling gains nothing. */
export const X402_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
