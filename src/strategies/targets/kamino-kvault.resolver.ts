/**
 * Kamino kvault ("Earn" share-vault) resolver — turns a DeFiLlama `sentora`
 * pool on Solana into a `{ kind: "kamino-kvault", vault, mint }` target for
 * the mobile `KaminoKvaultAdapter`. Venue table: `kamino-kvault.config.ts`
 * (see its header for why this is `sentora`-project + exact-`poolMeta`
 * matched rather than a discovery join).
 *
 * No on-chain probe: the target names a fixed, pre-verified vault (pinned
 * coordinates, cross-checked live against the resolver's own decode) — same
 * posture as the Solana LST resolver. Fail closed: unknown `poolMeta` /
 * non-Solana chain / underlying-mint mismatch → `null` → the pool stays
 * "manual". The mint cross-check guards against the venue table silently
 * drifting from a future on-chain vault migration.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { kvaultVenueByPoolMeta } from "./kamino-kvault.config";
import type { DepositTarget, PoolTargetResolver } from "./types";

export const KaminoKvaultResolver: PoolTargetResolver = {
  family: "kamino-kvault",
  aliases: ["sentora"],
  async resolve(pool: DeFiLlamaYieldPool): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    const venue = kvaultVenueByPoolMeta(pool.poolMeta);
    if (!venue) return null;
    const underlying = pool.underlyingTokens?.[0];
    if (underlying && underlying !== venue.mint) return null;
    return { kind: "kamino-kvault", vault: venue.vault, mint: venue.mint };
  },
};
