/**
 * Canonical channel → Duitku wire-code mapping.
 *
 * Spec ref: duitku_payout_provider_research.md §2.7.
 *
 * Duitku's `listBank` endpoint could produce this at runtime, but research
 * §2.3 explicitly says **don't** live-call it — the set of codes is stable
 * enough to pin, and a live call introduces a network dependency on
 * `pnpm prisma db seed`. If ops needs drift detection, a scheduled
 * reconciliation check is a separate follow-up.
 *
 * The seed script (task 11) consumes this via `upsert` so re-running seed
 * is idempotent. Admin tooling (future follow-up) should import from here
 * rather than duplicating the table.
 */
export const DUITKU_CHANNEL_CODES: Readonly<Record<string, string>> = Object.freeze({
  // Banks
  BCA: "014",
  MANDIRI: "008",
  BNI: "009",
  BRI: "002",
  CIMB: "022",
  PERMATA: "013",
  BTPN: "213",
  BSI: "451",
  JAGO: "542",
  // E-wallets
  OVO: "1010",
  GOPAY: "1011",
  DANA: "1012",
  SHOPEEPAY: "1013",
  LINKAJA: "1014",
});

/**
 * Reverse lookup — used by the reconcile/ops tooling when Duitku reports
 * a `bankCode` in a callback payload and we need to translate back to the
 * canonical `channelCode`. Built once at module load.
 */
export const CANONICAL_FROM_DUITKU: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(DUITKU_CHANNEL_CODES).map(([canonical, duitku]) => [
      duitku,
      canonical,
    ]),
  ),
);
