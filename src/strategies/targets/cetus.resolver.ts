/**
 * Cetus CLMM resolver (Sui) — spec §3.1, §5, §7.1. Built 2026-08-22.
 *
 * Cetus is a concentrated-liquidity DEX: many pools per asset pair (one per
 * fee tier), so `(chain=Sui, underlyingTokens)` alone is ambiguous —
 * `pool.poolMeta` (DeFiLlama's fee-tier string, e.g. `"1%"`) is the required
 * disambiguator, same role poolMeta plays for Ember's sibling vaults.
 *
 * Source = Cetus's own public HTTPS stats API
 * (`api-sui.cetus.zone/v2/sui/stats_pools`, §3.1: prefer the plain endpoint
 * over the SDK — this is the exact endpoint their own SDK's `aggregatorUrl`/
 * `statsPoolsUrl` config points at). A row carries `address` (the pool
 * object), `coin_a_address`/`coin_b_address` (on-chain leg order), and `fee`
 * as a bare fraction string (`"0.01"` == DeFiLlama's `"1%"`) — verified
 * against a live row (haSUI-SUI, fee=0.01 ↔ DeFiLlama poolMeta "1%").
 * `total` reports ~44k pools but the API only returns a page at a time
 * (`limit`/`offset`, capped at 100/request); paginated up to a bounded cap
 * here — DeFiLlama's own cetus-clmm catalog is a few dozen pools, all well
 * within the ranked pages this API returns first.
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

const STATS_POOLS_API = "https://api-sui.cetus.zone/v2/sui/stats_pools";
const PAGE_SIZE = 100;
const MAX_PAGES = 5; // 500 pools — comfortably covers DeFiLlama's cetus-clmm catalog
const POOLS_TTL_SEC = 30 * 60;

interface CetusPoolRow {
  address?: string;
  fee?: string; // bare fraction, e.g. "0.01" == 1%
  coin_a_address?: string;
  coin_b_address?: string;
  is_closed?: boolean;
  tick_spacing?: string | number;
}

interface CetusStatsPoolsPayload {
  data?: { lp_list?: CetusPoolRow[] };
}

async function fetchPoolRows(ctx: ResolverContext): Promise<CetusPoolRow[]> {
  const rows: CetusPoolRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const res = await ctx.fetchJsonCached<CetusStatsPoolsPayload>(
      `defillama:targets:cetus:pools:${offset}:v1`,
      `${STATS_POOLS_API}?is_vaults=false&limit=${PAGE_SIZE}&offset=${offset}`,
      POOLS_TTL_SEC,
    );
    const batch = res?.data?.lp_list ?? [];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * `pool.poolMeta` ("1%") → a fee PERCENTAGE number (1), to compare against
 * Cetus's own `fee` field (a bare fraction, e.g. "0.01" for the same tier —
 * verified against a live row, haSUI-SUI fee=0.01 ↔ DeFiLlama poolMeta
 * "1%"). Compared as numbers with a small epsilon, not strings: the API's
 * string formatting (trailing zeros, etc.) isn't a contract either side owes
 * the other.
 */
function feePercentFromPoolMeta(poolMeta: string): number | null {
  const trimmed = poolMeta.trim();
  const match = /^(\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
  if (!match) return null;
  const pct = Number.parseFloat(match[1]);
  return Number.isFinite(pct) ? pct : null;
}

const FEE_EPSILON = 1e-6;

export const CetusResolver: PoolTargetResolver = {
  family: "cetus-clmm",
  aliases: ["cetus-clmm", "cetus"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const [tokenA, tokenB] = pool.underlyingTokens ?? [];
    if (!tokenA || !tokenB) return null;
    const feePercent = feePercentFromPoolMeta(pool.poolMeta ?? "");
    if (feePercent === null) return null;

    const rows = await fetchPoolRows(ctx);
    const match = rows.find((r) => {
      if (r.is_closed) return false;
      if (!r.address || !r.coin_a_address || !r.coin_b_address) return false;
      const rowFeePercent = Number.parseFloat(r.fee ?? "");
      if (!Number.isFinite(rowFeePercent)) return false;
      if (Math.abs(rowFeePercent * 100 - feePercent) > FEE_EPSILON)
        return false;
      const a = `0x${r.coin_a_address.replace(/^0x/, "")}`;
      const b = `0x${r.coin_b_address.replace(/^0x/, "")}`;
      const sameOrder = eqSuiCoinType(a, tokenA) && eqSuiCoinType(b, tokenB);
      const swapped = eqSuiCoinType(a, tokenB) && eqSuiCoinType(b, tokenA);
      return sameOrder || swapped;
    });
    if (!match?.address || !match.coin_a_address || !match.coin_b_address) {
      return null;
    }
    const tickSpacing = Number(match.tick_spacing);
    if (!Number.isFinite(tickSpacing) || tickSpacing <= 0) return null;

    const type = await getSuiObjectType(match.address);
    if (!type) return null;

    return {
      kind: "cetus-clmm-pool",
      pool: match.address,
      coinTypeA: `0x${match.coin_a_address.replace(/^0x/, "")}`,
      coinTypeB: `0x${match.coin_b_address.replace(/^0x/, "")}`,
      tickSpacing,
    };
  },
};
