/**
 * Kamino kliquidity resolver — turns a DeFiLlama `kamino-liquidity` pool
 * into a `{ kind: "kamino-liquidity-strategy", strategy, mintA, mintB }`
 * target for the mobile `KaminoLiquidityAdapter`
 * (`services/defi/adapters/kaminoLiquidity.ts` — verification story for the
 * program id / instruction shape / math lives there). `kamino-liquidity` is
 * Kamino's managed CLMM vault product ("kliquidity"/"yvaults" on-chain,
 * program `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc`) — it wraps an Orca
 * Whirlpool / Raydium CLMM / Meteora DLMM position behind an auto-rebalancing
 * share vault. This resolver claims strategies on ALL THREE underlying DEXes;
 * the mobile adapter is what actually restricts to a supported subset (see
 * its header) — same split of responsibility as `SolanaLstResolver`.
 *
 * **DeFiLlama's `poolMeta` is always `null` for this project** (confirmed
 * live 2026-08-26, all 111 rows) — unlike Kamino Lend's market-name join,
 * there is no display-name key to match on. Kamino's own public
 * `GET /strategies` (list, no auth) DOES carry `tokenAMint`/`tokenBMint`
 * directly per strategy, so the join key here is the **mint pair** (order-
 * insensitive) against every `status === "LIVE"` strategy, exactly the same
 * shape as `raydium-cpmm.resolver.ts`'s `/pools/info/mint` join.
 *
 * **A mint pair very often matches MORE THAN ONE live strategy** — different
 * fee tiers / ranges on the same pair are each their own DeFiLlama pool row
 * AND their own Kamino strategy. Confirmed live 2026-08-26 against the full
 * 111-row catalog: disambiguating by nearest match to the pool's own
 * `tvlUsd` (via `GET /strategies/metrics`'s `totalValueLocked`) resolves
 * 108/111 rows cleanly when the closest candidate is (a) within 15% of the
 * pool's reported `tvlUsd` and (b) at least 2x closer than the runner-up —
 * looser than `kamino-lend.resolver.ts`'s "10x closer, any distance" rule
 * because here EVERY live strategy on a shared pair is a real, plausible
 * candidate (not mostly-abandoned dust reserves), so the tie-break needs an
 * absolute closeness bar as well as a relative one. The remaining 3 rows
 * correctly fail closed (no live strategy shares their mint pair at all).
 *
 * No on-chain probe here, and deliberately no DEX-family or
 * share-calculation-method filtering either: `GET /strategies` doesn't
 * expose `strategyDex`/`shareCalculationMethod` (only a live account decode
 * does), and this resolver's job is address recovery, not scope-gating —
 * the mobile adapter reads and validates the strategy's live state (DEX,
 * share-calc method, status, deposit/withdraw-blocked flags) itself before
 * building any instruction, mirroring `SolanaLstResolver`'s split of
 * responsibility. A strategy this resolver targets that the adapter can't
 * support yet (Raydium/Meteora-backed, or `DOLAR_BASED` share accounting)
 * fails closed to Manual at build time, not here.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const KAMINO_API_BASE = "https://api.kamino.finance";
export const KAMINO_LIQUIDITY_PROGRAM_ID =
  "6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc";

interface StrategyRow {
  address?: unknown;
  status?: unknown;
  tokenAMint?: unknown;
  tokenBMint?: unknown;
}

interface StrategyMetricsRow {
  strategy?: unknown;
  totalValueLocked?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function loadLiveStrategies(
  ctx: ResolverContext,
): Promise<Array<{ address: string; mintA: string; mintB: string }>> {
  const payload = await ctx.fetchJsonCached<unknown>(
    "defillama:targets:kamino-liquidity:strategies:v1",
    `${KAMINO_API_BASE}/strategies`,
    30 * 60,
  );
  if (!Array.isArray(payload)) return [];
  return (payload as StrategyRow[]).flatMap((row) => {
    if (row.status !== "LIVE") return [];
    const address = str(row.address);
    const mintA = str(row.tokenAMint);
    const mintB = str(row.tokenBMint);
    return address && mintA && mintB ? [{ address, mintA, mintB }] : [];
  });
}

async function loadTvlByStrategy(
  ctx: ResolverContext,
): Promise<Map<string, number>> {
  const payload = await ctx.fetchJsonCached<unknown>(
    "defillama:targets:kamino-liquidity:metrics:v1",
    `${KAMINO_API_BASE}/strategies/metrics`,
    30 * 60,
  );
  const map = new Map<string, number>();
  if (!Array.isArray(payload)) return map;
  for (const row of payload as StrategyMetricsRow[]) {
    const strategy = str(row.strategy);
    if (strategy) map.set(strategy, num(row.totalValueLocked));
  }
  return map;
}

interface Candidate {
  address: string;
  mintA: string;
  mintB: string;
  tvlUsd: number;
}

/**
 * Nearest-match-and-dominant disambiguation — see file header for why this
 * needs both a relative AND an absolute closeness bar, unlike the
 * "furthest-outlier-wins" 10x rule used elsewhere in this file family.
 */
function disambiguateByNearestTvl(
  candidates: Candidate[],
  poolTvlUsd: number,
): Candidate | null {
  const ranked = [...candidates].sort(
    (a, b) => Math.abs(a.tvlUsd - poolTvlUsd) - Math.abs(b.tvlUsd - poolTvlUsd),
  );
  const [best, runnerUp] = ranked;
  if (!best) return null;
  const bestDiffRatio =
    Math.abs(best.tvlUsd - poolTvlUsd) / Math.max(poolTvlUsd, 1);
  if (bestDiffRatio >= 0.15) return null;
  if (!runnerUp) return best;
  const runnerUpDiffRatio =
    Math.abs(runnerUp.tvlUsd - poolTvlUsd) / Math.max(poolTvlUsd, 1);
  if (runnerUpDiffRatio < bestDiffRatio * 2) return null;
  return best;
}

export const KaminoLiquidityResolver: PoolTargetResolver = {
  family: "kamino-liquidity",
  async resolve(
    pool: DeFiLlamaYieldPool,
    ctx: ResolverContext,
  ): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    if ((pool.project ?? "").toLowerCase() !== "kamino-liquidity") return null;
    const [mint1, mint2] = pool.underlyingTokens ?? [];
    if (!mint1 || !mint2) return null;

    const [strategies, tvlByStrategy] = await Promise.all([
      loadLiveStrategies(ctx),
      loadTvlByStrategy(ctx),
    ]);
    const pairKey = (a: string, b: string) => [a, b].sort().join(":");
    const wanted = pairKey(mint1, mint2);
    const candidates: Candidate[] = strategies
      .filter((s) => pairKey(s.mintA, s.mintB) === wanted)
      .map((s) => ({
        address: s.address,
        mintA: s.mintA,
        mintB: s.mintB,
        tvlUsd: tvlByStrategy.get(s.address) ?? 0,
      }));

    // Always checked against the pool's own `tvlUsd`, even for a single
    // candidate: unlike `kamino-lend.resolver.ts`/`raydium-cpmm.resolver.ts`
    // (market-name+mint / on-chain-programId joins), a mint-pair-only join
    // is coarse enough that a single match still deserves a sanity check
    // before being trusted.
    const winner =
      candidates.length > 0
        ? disambiguateByNearestTvl(candidates, pool.tvlUsd ?? 0)
        : null;
    if (!winner) return null;

    return {
      kind: "kamino-liquidity-strategy",
      strategy: winner.address,
      mintA: winner.mintA,
      mintB: winner.mintB,
    };
  },
};
