/**
 * Raydium legacy AMM v4 resolver — turns a DeFiLlama `raydium-amm` pool
 * into a `{ kind: "raydium-amm-v4-pool", pool, mintA, mintB }` target for
 * the mobile `RaydiumAmmV4Adapter` (`services/defi/adapters/
 * raydiumAmmV4.ts` — verification story lives there). Sibling of
 * `raydium-cpmm.resolver.ts`; see that file's header for why DeFiLlama's
 * `raydium-amm` project needs splitting by program at all.
 *
 * Filters Raydium's own `GET /pools/info/mint` API to
 * `programId === AMM_V4_PROGRAM_ID` AND `pooltype` containing BOTH `"Amm"`
 * and `"OpenBookMarket"` — excluding the rarer `StablePool` variant (its
 * own curve, extra account, not built) and any pool without a live
 * OpenBook link, which the adapter's OpenBook-market read assumes exists.
 * Same TVL-disambiguation discipline as `raydium-cpmm.resolver.ts` /
 * `kamino-lend.resolver.ts` when a mint pair resolves to multiple AMM v4
 * pools (rare, but the same address-space allows it).
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const RAYDIUM_API_BASE = "https://api-v3.raydium.io";
export const RAYDIUM_AMM_V4_PROGRAM_ID =
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

interface RaydiumAmmV4Candidate {
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
): Promise<RaydiumAmmV4Candidate[]> {
  // Same order-independent sort as raydium-cpmm.resolver.ts, for a stable
  // cache key — the API itself is order-insensitive (verified live).
  const [a, b] = [mint1, mint2].sort();
  const payload = await ctx.fetchJsonCached<unknown>(
    `defillama:targets:raydium-amm-v4:mint:${a}:${b}:v1`,
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

/** Same discipline as the sibling CPMM/Kamino-Lend resolvers. */
function disambiguateByTvl(
  candidates: RaydiumAmmV4Candidate[],
  poolTvlUsd: number,
): RaydiumAmmV4Candidate | null {
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

export const RaydiumAmmV4Resolver: PoolTargetResolver = {
  family: "raydium-amm-v4",
  // Claims the SAME `raydium-amm` alias as `raydium-cpmm.resolver.ts` —
  // `registry.ts`'s exact-claimant set can hold multiple resolvers for one
  // project (its own header: "Family A tried BEFORE its raw cToken
  // market"), tried in REGISTRATION order (`resolveTarget`'s loop) until
  // one returns non-null. Registered after the CPMM resolver in
  // bootstrap.ts; in practice the two never actually compete for the same
  // pool row — each returns null whenever ITS program has no candidate for
  // the mint pair, so whichever program the pair actually uses is the one
  // that resolves.
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
    const ammV4Only = candidates.filter(
      (c) =>
        c.programId === RAYDIUM_AMM_V4_PROGRAM_ID &&
        c.pooltype.includes("Amm") &&
        c.pooltype.includes("OpenBookMarket"),
    );
    const winner =
      ammV4Only.length === 1
        ? ammV4Only[0]
        : ammV4Only.length > 1
          ? disambiguateByTvl(ammV4Only, pool.tvlUsd ?? 0)
          : null;
    if (!winner) return null;

    return {
      kind: "raydium-amm-v4-pool",
      pool: winner.id,
      mintA: winner.mintA,
      mintB: winner.mintB,
    };
  },
};
