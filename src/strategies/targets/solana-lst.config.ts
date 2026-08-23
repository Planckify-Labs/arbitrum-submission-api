/**
 * Solana liquid-staking (LST) venue table — the BACKEND twin of the mobile
 * `services/defi/adapters/solana/lst.config.ts`. Keep the two in sync.
 *
 * Only what the backend needs to resolve a DeFiLlama pool back to a
 * `{ kind: "solana-lst-stake", venue, poolMint }` target: the venue key and
 * its DeFiLlama project slug. The mobile config owns every other
 * program/pool/state coordinate (deposit/withdraw don't run here).
 *
 * `poolMint` per venue, verified 2026-08-22 via live `getAccountInfo` reads
 * of each venue's `StakePool` account (Jito/JupSOL/dSOL) or the protocol's
 * own published contract-addresses page (Marinade) — see the mobile config's
 * header for the full verification story.
 *
 * 12 more venues added 2026-08-23 (phantom/dfdv/hylo/bonk/helius/bybit/
 * thevault/doublezero/blazestake/jpool/binance/jagpool) — `poolMint` here is
 * each venue's on-chain `StakePool.pool_mint`, read live and cross-checked
 * against `igneous-labs/sanctum-lst-list`'s published mint for the same
 * pool; see the mobile config's header for the full two-way verification.
 *
 * 13th venue, `solstrategies` (stkeSOL), added 2026-08-23 — absent from the
 * Sanctum list, verified instead against its own `yield-server` adaptor's
 * `STKESOL_MINT` constant plus a live `getAccountInfo` read; see the mobile
 * config's header for the full story.
 */

export type SolanaLstVenue =
  | "jito"
  | "jupsol"
  | "dsol"
  | "marinade"
  | "phantom"
  | "dfdv"
  | "hylo"
  | "bonk"
  | "helius"
  | "bybit"
  | "thevault"
  | "doublezero"
  | "blazestake"
  | "jpool"
  | "binance"
  | "jagpool"
  | "solstrategies";

export interface SolanaLstVenueInfo {
  venue: SolanaLstVenue;
  /** DeFiLlama project slug — the pool `project` this venue resolves. */
  defillamaSlug: string;
  /** Receipt (liquid-staking) mint address. */
  poolMint: string;
  symbol: string;
}

export const SOLANA_LST_VENUES: SolanaLstVenueInfo[] = [
  {
    venue: "jito",
    defillamaSlug: "jito-liquid-staking",
    poolMint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    symbol: "JitoSOL",
  },
  {
    venue: "jupsol",
    defillamaSlug: "jupiter-staked-sol",
    poolMint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
    symbol: "JupSOL",
  },
  {
    venue: "dsol",
    defillamaSlug: "drift-staked-sol",
    poolMint: "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ",
    symbol: "dSOL",
  },
  {
    venue: "marinade",
    defillamaSlug: "marinade-liquid-staking",
    poolMint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    symbol: "mSOL",
  },
  {
    venue: "phantom",
    defillamaSlug: "phantom-sol",
    poolMint: "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL",
    symbol: "PSOL",
  },
  {
    venue: "dfdv",
    defillamaSlug: "dfdv-staked-sol",
    poolMint: "sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx",
    symbol: "dfdvSOL",
  },
  {
    venue: "hylo",
    defillamaSlug: "hylo-lsts",
    poolMint: "hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT",
    symbol: "hyloSOL",
  },
  {
    venue: "bonk",
    defillamaSlug: "bonk-staked-sol",
    poolMint: "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs",
    symbol: "bonkSOL",
  },
  {
    venue: "helius",
    defillamaSlug: "helius-staked-sol",
    poolMint: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A",
    symbol: "hSOL",
  },
  {
    venue: "bybit",
    defillamaSlug: "bybit-staked-sol",
    poolMint: "Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B",
    symbol: "bbSOL",
  },
  {
    venue: "thevault",
    defillamaSlug: "the-vault-liquid-staking",
    poolMint: "vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7",
    symbol: "vSOL",
  },
  {
    venue: "doublezero",
    defillamaSlug: "doublezero-staked-sol",
    poolMint: "Gekfj7SL2fVpTDxJZmeC46cTYxinjB6gkAnb6EGT6mnn",
    symbol: "dzSOL",
  },
  {
    venue: "blazestake",
    defillamaSlug: "blazestake",
    poolMint: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
    symbol: "bSOL",
  },
  {
    venue: "jpool",
    defillamaSlug: "jpool",
    poolMint: "7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn",
    symbol: "JSOL",
  },
  {
    venue: "binance",
    defillamaSlug: "binance-staked-sol",
    poolMint: "BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85",
    symbol: "BNSOL",
  },
  {
    venue: "jagpool",
    defillamaSlug: "jagpool-staked-sol",
    poolMint: "jag58eRBC1c88LaAsRPspTMvoKJPbnzw9p9fREzHqyV",
    symbol: "jagSOL",
  },
  {
    venue: "solstrategies",
    defillamaSlug: "stkesol-by-sol-strategies",
    poolMint: "stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh",
    symbol: "stkeSOL",
  },
];

export function lstVenueBySlug(slug: string): SolanaLstVenueInfo | undefined {
  const needle = slug.toLowerCase();
  return SOLANA_LST_VENUES.find((v) => v.defillamaSlug.toLowerCase() === needle);
}

export const SOLANA_LST_SLUGS: string[] = SOLANA_LST_VENUES.map(
  (v) => v.defillamaSlug,
);
