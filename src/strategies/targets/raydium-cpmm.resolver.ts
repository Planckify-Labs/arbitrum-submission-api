/**
 * Raydium CPMM resolver — turns a DeFiLlama `raydium-amm` pool into a
 * `{ kind: "raydium-cpmm-pool", pool, mintA, mintB }` target for the mobile
 * `RaydiumCpmmAdapter` (`services/defi/adapters/raydiumCpmm.ts` —
 * verification story for the program id / instruction shape lives there).
 *
 * **DeFiLlama's `raydium-amm` project bundles THREE different on-chain
 * programs under one slug**, distinguished only by `poolMeta`, confirmed
 * live 2026-08-23 against the full pool set: 985 "Standard - X%" rows (985
 * of which split between the legacy AMM v4 program,
 * `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` — OpenBook-linked, the
 * majority of real "Standard" TVL — and the newer, self-contained CPMM
 * program this resolver targets) and 553 "Concentrated - X%" rows (CLMM, a
 * different program entirely, not built). This resolver claims ONLY the
 * CPMM ones; everything else (AMM v4, CLMM) returns `null` and stays
 * Manual until those get their own kind + adapter.
 *
 * **DeFiLlama's `pool` field is NOT the on-chain pool address** (same
 * synthetic-UUID situation as `kamino-lend.resolver.ts`), so the real
 * address is recovered by joining Raydium's own public
 * `GET /pools/info/mint?mint1=&mint2=&poolType=standard` API on the pool's
 * `underlyingTokens` pair (confirmed order-insensitive live). **A mint pair
 * can legitimately resolve to MULTIPLE pools** — different fee-tier
 * configs, and/or the legacy AMM v4 pool for the same pair — confirmed live
 * on WSOL/USELESS: 3 CPMM pools ($2.29M / $0.90 / $0.01 tvl) plus 1 AMM v4
 * pool ($22.81), all returned by one query. This resolver first filters to
 * `programId === CPMM_PROGRAM_ID`, then — same discipline as
 * `kamino-lend.resolver.ts` — disambiguates any remaining tie by distance
 * to the pool's own `tvlUsd`, requiring the winner to be at least 10x
 * closer than the runner-up or the match stays ambiguous (`null`).
 *
 * No on-chain probe here: the mobile adapter reads and validates the
 * pool's live state (mints, status, reserves) itself before building any
 * instruction, mirroring `SolanaLstResolver`'s split of responsibility.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const RAYDIUM_API_BASE = "https://api-v3.raydium.io";
export const RAYDIUM_CPMM_PROGRAM_ID =
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

interface RaydiumPoolCandidate {
  id: string;
  programId: string;
  mintA: string;
  mintB: string;
  tvlUsd: number;
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
): Promise<RaydiumPoolCandidate[]> {
  // Sort so the cache key is stable regardless of the DeFiLlama row's
  // underlyingTokens order — the API itself is order-insensitive (verified
  // live both ways), but the cache key still needs to be.
  const [a, b] = [mint1, mint2].sort();
  const payload = await ctx.fetchJsonCached<unknown>(
    `defillama:targets:raydium-cpmm:mint:${a}:${b}:v1`,
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
    if (!id || !programId || !mintA || !mintB) return [];
    return [{ id, programId, mintA, mintB, tvlUsd: num(r.tvl) }];
  });
}

/**
 * Same discipline as `kamino-lend.resolver.ts`'s `disambiguateByTvl`: the
 * closest candidate must be at least 10x closer than the runner-up, or the
 * match stays ambiguous (`null`).
 */
function disambiguateByTvl(
  candidates: RaydiumPoolCandidate[],
  poolTvlUsd: number,
): RaydiumPoolCandidate | null {
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

export const RaydiumCpmmResolver: PoolTargetResolver = {
  family: "raydium-cpmm",
  aliases: ["raydium-amm"],
  async resolve(
    pool: DeFiLlamaYieldPool,
    ctx: ResolverContext,
  ): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    if ((pool.project ?? "").toLowerCase() !== "raydium-amm") return null;
    // "Concentrated - X%" is CLMM (a different program, not built) —
    // Standard-only, and only "Standard" — see header.
    if (!(pool.poolMeta ?? "").startsWith("Standard")) return null;
    const [mint1, mint2] = pool.underlyingTokens ?? [];
    if (!mint1 || !mint2) return null;

    const candidates = await loadCandidates(ctx, mint1, mint2);
    const cpmmOnly = candidates.filter(
      (c) => c.programId === RAYDIUM_CPMM_PROGRAM_ID,
    );
    const winner =
      cpmmOnly.length === 1
        ? cpmmOnly[0]
        : cpmmOnly.length > 1
          ? disambiguateByTvl(cpmmOnly, pool.tvlUsd ?? 0)
          : null;
    if (!winner) return null;

    return {
      kind: "raydium-cpmm-pool",
      pool: winner.id,
      mintA: winner.mintA,
      mintB: winner.mintB,
    };
  },
};
