/**
 * Solana liquid-staking resolver — mirrors `suilst.resolver.ts`.
 *
 * Turns a DeFiLlama Solana LST pool (Jito / JupSOL / dSOL / Marinade, plus 12
 * more `spl-stake-pool` venues added 2026-08-23 — all real `/pools` rows,
 * unlike the synthesized Sui LST venues) into a `{ kind: "solana-lst-stake",
 * venue, poolMint }` target for the mobile `SolanaLstAdapter`, matching on
 * the pool's `project`. Venue table: `solana-lst.config.ts`.
 *
 * This closes the exact gap the EVM Lido finding described (§11.6a): the
 * mobile-side Jito adapter had shipped since Phase 2 with no resolver ever
 * claiming its slug, so `depositTarget` was never set and the single largest
 * Solana pool in the catalog rendered as a deep link despite having a
 * complete, working adapter. `jito-solana` was never even the right slug to
 * claim — the real DeFiLlama project is `jito-liquid-staking`.
 *
 * No on-chain probe: the target names a fixed, pre-verified venue (the
 * pinned program/pool/state coordinates live in the mobile adapter's
 * config), not a discovered address — same as the single-market Scallop
 * path. Fail closed: unknown project / non-Solana chain → `null` → the pool
 * stays "manual".
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { lstVenueBySlug, SOLANA_LST_SLUGS } from "./solana-lst.config";
import type { DepositTarget, PoolTargetResolver } from "./types";

export const SolanaLstResolver: PoolTargetResolver = {
  family: "solana-lst",
  aliases: SOLANA_LST_SLUGS,
  async resolve(pool: DeFiLlamaYieldPool): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    const info = lstVenueBySlug(pool.project ?? "");
    if (!info) return null;
    return { kind: "solana-lst-stake", venue: info.venue, poolMint: info.poolMint };
  },
};
