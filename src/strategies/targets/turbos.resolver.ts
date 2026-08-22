/**
 * Turbos Finance CLMM resolver (Sui) — spec §3.1, §5, §7.1. Built 2026-08-22,
 * same session/pattern as `cetus.resolver.ts`.
 *
 * Concentrated liquidity, one pool per (pair, fee tier), so `poolMeta` (the
 * fee-tier string) is the required disambiguator — same reasoning as Cetus.
 *
 * Source = Turbos's own public HTTPS stats API (`api2.turbos.finance/pools`,
 * `Api-Version: v2` header, `pageSize` capped by the API itself — 100 is the
 * accepted value, matching the `pageSize` DeFiLlama's own `turbos` adaptor in
 * `DefiLlama/yield-server` uses). A row carries `pool_id`, `coin_type_a`/
 * `coin_type_b` (on-chain leg order), `fee_type` (the pool's third generic —
 * Turbos parametrizes the fee tier as a TYPE, not just a number), and
 * `tick_spacing` directly (no separate lookup, unlike Cetus). `fee` is a raw
 * integer where `fee/10000` = percent (verified against a live row: fee=100 →
 * 0.01%, matching DeFiLlama's own `poolMeta: `${fee/10000}%`` formula in its
 * turbos adaptor — replicated here exactly for matching). `total` reports
 * ~614 pools across 100-per-page pages; paginated up to a bounded cap.
 *
 * Fail closed: no fee-tier match / no pair match in that tier / unreadable
 * pool object → `null` → manual.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { eqSuiCoinType, getSuiObjectType } from "./sui-rpc";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const POOLS_API = "https://api2.turbos.finance/pools";
const PAGE_SIZE = 100;
const MAX_PAGES = 8; // 800 pools — comfortably covers the ~614-pool total and DeFiLlama's catalog
const POOLS_TTL_SEC = 30 * 60;

interface TurbosPoolRow {
  pool_id?: string;
  fee?: number | string;
  fee_type?: string;
  tick_spacing?: number | string;
  coin_type_a?: string;
  coin_type_b?: string;
  unlocked?: boolean;
}

interface TurbosPoolsPayload {
  result?: TurbosPoolRow[];
  total?: number;
}

async function fetchPoolRows(ctx: ResolverContext): Promise<TurbosPoolRow[]> {
  const rows: TurbosPoolRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await ctx.fetchJsonCached<TurbosPoolsPayload>(
      `defillama:targets:turbos:pools:${page}:v1`,
      `${POOLS_API}?page=${page}&pageSize=${PAGE_SIZE}&includeRisk=false`,
      POOLS_TTL_SEC,
      { headers: { "Api-Version": "v2" } },
    );
    const batch = res?.result ?? [];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

/** `pool.poolMeta` ("0.01%") → a fee PERCENTAGE number (0.01), to compare
 *  against Turbos's own `fee` field (a raw integer, e.g. 100 for the same
 *  tier — `fee/10000` = percent, verified against a live row and matching
 *  DeFiLlama's own turbos adaptor's exact formula). */
function feePercentFromPoolMeta(poolMeta: string): number | null {
  const trimmed = poolMeta.trim();
  const match = /^(\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
  if (!match) return null;
  const pct = Number.parseFloat(match[1]);
  return Number.isFinite(pct) ? pct : null;
}

const FEE_EPSILON = 1e-6;

export const TurbosResolver: PoolTargetResolver = {
  family: "turbos",
  aliases: ["turbos", "turbos-finance"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const [tokenA, tokenB] = pool.underlyingTokens ?? [];
    if (!tokenA || !tokenB) return null;
    const feePercent = feePercentFromPoolMeta(pool.poolMeta ?? "");
    if (feePercent === null) return null;

    const rows = await fetchPoolRows(ctx);
    const match = rows.find((r) => {
      if (r.unlocked === false) return false;
      if (!r.pool_id || !r.coin_type_a || !r.coin_type_b || !r.fee_type) {
        return false;
      }
      const rowFeePercent = Number(r.fee);
      if (!Number.isFinite(rowFeePercent)) return false;
      if (Math.abs(rowFeePercent / 10000 - feePercent) > FEE_EPSILON) {
        return false;
      }
      const a = `0x${r.coin_type_a.replace(/^0x/, "")}`;
      const b = `0x${r.coin_type_b.replace(/^0x/, "")}`;
      const sameOrder = eqSuiCoinType(a, tokenA) && eqSuiCoinType(b, tokenB);
      const swapped = eqSuiCoinType(a, tokenB) && eqSuiCoinType(b, tokenA);
      return sameOrder || swapped;
    });
    if (!match?.pool_id || !match.coin_type_a || !match.coin_type_b) {
      return null;
    }
    const tickSpacing = Number(match.tick_spacing);
    if (!Number.isFinite(tickSpacing) || tickSpacing <= 0) return null;
    const feeType = `0x${(match.fee_type ?? "").replace(/^0x/, "")}`;

    const type = await getSuiObjectType(match.pool_id);
    if (!type) return null;

    return {
      kind: "turbos-clmm-pool",
      pool: match.pool_id,
      coinTypeA: `0x${match.coin_type_a.replace(/^0x/, "")}`,
      coinTypeB: `0x${match.coin_type_b.replace(/^0x/, "")}`,
      feeType,
      tickSpacing,
    };
  },
};
