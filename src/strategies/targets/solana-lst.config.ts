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
 */

export type SolanaLstVenue = "jito" | "jupsol" | "dsol" | "marinade";

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
];

export function lstVenueBySlug(slug: string): SolanaLstVenueInfo | undefined {
  const needle = slug.toLowerCase();
  return SOLANA_LST_VENUES.find((v) => v.defillamaSlug.toLowerCase() === needle);
}

export const SOLANA_LST_SLUGS: string[] = SOLANA_LST_VENUES.map(
  (v) => v.defillamaSlug,
);
