/**
 * Raydium legacy Stable Swap AMM ("version 5") resolver — turns a
 * DeFiLlama `raydium-amm` pool into a `{ kind: "raydium-stable-pool", pool,
 * mintA, mintB }` target for the mobile `RaydiumAmmV4Adapter`, which
 * handles this program alongside plain AMM v4 (verification story lives in
 * `services/defi/adapters/raydiumAmmV4.ts`'s header). Sibling of
 * `raydium-amm-v4.resolver.ts` and `raydium-cpmm.resolver.ts` — see either
 * file's header for why DeFiLlama's `raydium-amm` project needs splitting
 * by program at all.
 *
 * Filters Raydium's own `GET /pools/info/mint` API to
 * `programId === STABLE_PROGRAM_ID` AND `pooltype` containing `"StablePool"`
 * — confirmed live 2026-08-23 (`https://api-v3.raydium.io/pools/info/mint`
 * on a USDC/USDT pair returns `pooltype: ["StablePool", "Stables"]` for this
 * program). Same TVL-disambiguation discipline as the sibling resolvers when
 * a mint pair resolves to multiple StablePool pools.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const RAYDIUM_API_BASE = "https://api-v3.raydium.io";
export const RAYDIUM_STABLE_PROGRAM_ID =
  "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h";

interface RaydiumStableCandidate {
  id: string;
  programId: string;
  mintA: string;
  mintB: string;
  tvlUsd: number;
  pooltype: string[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

async function loadCandidates(
  ctx: ResolverContext,
  mint1: string,
  mint2: string,
): Promise<RaydiumStableCandidate[]> {
  // Same order-independent sort as the sibling resolvers, for a stable
  // cache key — the API itself is order-insensitive (verified live).
  const [a, b] = [mint1, mint2].sort();
  const payload = await ctx.fetchJsonCached<unknown>(
    `defillama:targets:raydium-stable:mint:${a}:${b}:v1`,
    `${RAYDIUM_API_BASE}/pools/info/mint?mint1=${a}&mint2=${b}&poolType=standard&poolSortField=liquidity&sortType=desc&pageSize=50&page=1`,
    10 * 60,
  );
  const rows = (payload as { data?: { data?: unknown } } | null)?.data?.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const programId = str(r.programId);
    const mintA = str(
      (r.mintA as Record<string, unknown> | undefined)?.address,
    );
    const mintB = str(
      (r.mintB as Record<string, unknown> | undefined)?.address,
    );
    const pooltype = Array.isArray(r.pooltype)
      ? (r.pooltype as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    if (!id || !programId || !mintA || !mintB) return [];
    return [{ id, programId, mintA, mintB, tvlUsd: num(r.tvl), pooltype }];
  });
}

/** Same discipline as the sibling CPMM/AMM-v4/Kamino-Lend resolvers. */
function disambiguateByTvl(
  candidates: RaydiumStableCandidate[],
  poolTvlUsd: number,
): RaydiumStableCandidate | null {
  const ranked = [...candidates].sort(
    (a, b) => Math.abs(a.tvlUsd - poolTvlUsd) - Math.abs(b.tvlUsd - poolTvlUsd),
  );
  const [best, runnerUp] = ranked;
  if (!best) return null;
  const bestDistance = Math.abs(best.tvlUsd - poolTvlUsd);
  if (!runnerUp) return best;
  const runnerUpDistance = Math.abs(runnerUp.tvlUsd - poolTvlUsd);
  if (bestDistance > 0 && runnerUpDistance / bestDistance < 10) return null;
  return best;
}

export const RaydiumStableResolver: PoolTargetResolver = {
  family: "raydium-stable",
  // Claims the SAME `raydium-amm` alias as the CPMM/AMM-v4 resolvers — the
  // registry's exact-claimant set can hold multiple resolvers for one
  // project, tried in registration order until one returns non-null. The
  // three never actually compete for the same pool row — each returns null
  // whenever ITS program has no candidate for the mint pair.
  aliases: ["raydium-amm"],
  async resolve(
    pool: DeFiLlamaYieldPool,
    ctx: ResolverContext,
  ): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    if ((pool.project ?? "").toLowerCase() !== "raydium-amm") return null;
    if (!(pool.poolMeta ?? "").startsWith("Standard")) return null;
    const [mint1, mint2] = pool.underlyingTokens ?? [];
    if (!mint1 || !mint2) return null;

    const candidates = await loadCandidates(ctx, mint1, mint2);
    const stableOnly = candidates.filter(
      (c) =>
        c.programId === RAYDIUM_STABLE_PROGRAM_ID &&
        c.pooltype.includes("StablePool"),
    );
    const winner =
      stableOnly.length === 1
        ? stableOnly[0]
        : stableOnly.length > 1
          ? disambiguateByTvl(stableOnly, pool.tvlUsd ?? 0)
          : null;
    if (!winner) return null;

    return {
      kind: "raydium-stable-pool",
      pool: winner.id,
      mintA: winner.mintA,
      mintB: winner.mintB,
    };
  },
};
