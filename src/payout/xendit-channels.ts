/**
 * Canonical channel → Xendit Payouts API (`/v2/payouts`) wire-code mapping.
 *
 * Xendit's Payouts (disbursement) API uses a different channel-code
 * namespace from the Payment Methods (collection) API — disbursement
 * codes are country-prefixed (`ID_OVO`, `ID_BCA`, …). Sending the bare
 * collection code (`OVO`) returns `Channel code is not supported`.
 *
 * The authoritative list is `GET https://api.xendit.co/payouts_channels`
 * (Basic auth with the secret key). When a code below is wrong or absent,
 * fetch that endpoint and reconcile.
 *
 * Note on GoPay: Xendit historically did NOT disburse to GoPay — merchants
 * who need GoPay payouts should be routed through Flip instead (see
 * `flip-channels.ts`). The entry below is best-effort for environments
 * where Xendit later enables it; verify before relying on it.
 */
export const XENDIT_CHANNEL_CODES: Readonly<Record<string, string>> = Object.freeze({
  // Banks
  BCA: "ID_BCA",
  MANDIRI: "ID_MANDIRI",
  BNI: "ID_BNI",
  BRI: "ID_BRI",
  // E-wallets
  OVO: "ID_OVO",
  DANA: "ID_DANA",
  SHOPEEPAY: "ID_SHOPEEPAY",
  LINKAJA: "ID_LINKAJA",
  GOPAY: "ID_GOPAY",
});
