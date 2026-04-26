/**
 * Canonical channel → Flip wire-code mapping.
 *
 * Spec ref: flip_payout_provider_spec.md §2.8, §4.7.
 *
 * Phase 1 channels only — the full §2.8 list (100+ banks) is reference
 * for future expansion as merchant demand requires. The seed script
 * (task 14) and the adapter both consume this via import; no duplicated
 * mappings anywhere.
 *
 * Flip's API is case-sensitive on `bank_code` — all values here are
 * lowercase exactly as Flip documents them.
 */
export const FLIP_CHANNEL_CODES: Readonly<Record<string, string>> = Object.freeze({
  // Banks
  BCA: "bca",
  MANDIRI: "mandiri",
  BNI: "bni",
  BRI: "bri",
  CIMB: "cimb",
  PERMATA: "permata",
  BTPN: "tabungan_pensiunan_nasional",
  BSI: "bsm",
  JAGO: "artos",
  // E-wallets
  OVO: "ovo",
  GOPAY: "gopay",
  DANA: "dana",
  SHOPEEPAY: "shopeepay",
  LINKAJA: "linkaja",
});

/**
 * Reverse lookup — Flip bank code → canonical channel code.
 */
export const CANONICAL_FROM_FLIP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(FLIP_CHANNEL_CODES).map(([canonical, flip]) => [
      flip,
      canonical,
    ]),
  ),
);
