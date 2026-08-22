/**
 * Bluefin Spot CLMM resolver (Sui) — spec §3.1, §5, §7.1. Built 2026-08-22,
 * same session/pattern as `cetus.resolver.ts`/`turbos.resolver.ts`.
 *
 * Concentrated liquidity, one pool per (pair, fee tier), so `poolMeta` is the
 * required disambiguator — same reasoning as Cetus/Turbos.
 *
 * Source = Bluefin's own public HTTPS stats API
 * (`swap.api.sui-prod.bluefin.io/api/v1/pools/info`, the exact endpoint
 * DeFiLlama's own `bluefin-spot` adaptor in `DefiLlama/yield-server` reads).
 * A row carries `address` (the pool object), `tokenA.info.address`/
 * `tokenB.info.address` (on-chain leg order, ALREADY 0x-prefixed unlike
 * Cetus/Turbos's rows — normalized defensively anyway), `config.tickSpacing`,
 * and `feeRate` as a bare PERCENT string (`"0.1750"` == 0.175%, verified
 * against a live row and matching DeFiLlama's own
 * `poolMeta: `${Number(feeRate)}%`` formula exactly — no /10000 or *100
 * scaling needed here, unlike Cetus's fraction or Turbos's raw-integer
 * conventions). `limit` is accepted up to 500 in one page — no pagination
 * needed (DeFiLlama's own catalog is a few dozen pools, comfortably under
 * that).
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

const POOLS_API = "https://swap.api.sui-prod.bluefin.io/api/v1/pools/info";
const POOLS_LIMIT = 500;
const POOLS_TTL_SEC = 30 * 60;

interface BluefinPoolRow {
  address?: string;
  feeRate?: string;
  is_paused?: boolean;
  config?: { tickSpacing?: number | string };
  tokenA?: { info?: { address?: string } };
  tokenB?: { info?: { address?: string } };
}

async function fetchPoolRows(ctx: ResolverContext): Promise<BluefinPoolRow[]> {
  const res = await ctx.fetchJsonCached<BluefinPoolRow[]>(
    "defillama:targets:bluefin-spot:pools:v1",
    `${POOLS_API}?limit=${POOLS_LIMIT}`,
    POOLS_TTL_SEC,
  );
  return Array.isArray(res) ? res : [];
}

/** `pool.poolMeta` ("0.175%") → a fee PERCENTAGE number (0.175), to compare
 *  against Bluefin's own `feeRate` field — ALREADY a bare percent string
 *  (`"0.1750"` == 0.175%), verified against a live row and matching
 *  DeFiLlama's own bluefin-spot adaptor's exact formula. */
function feePercentFromPoolMeta(poolMeta: string): number | null {
  const trimmed = poolMeta.trim();
  const match = /^(\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
  if (!match) return null;
  const pct = Number.parseFloat(match[1]);
  return Number.isFinite(pct) ? pct : null;
}

const FEE_EPSILON = 1e-6;

export const BluefinSpotResolver: PoolTargetResolver = {
  family: "bluefin-spot",
  aliases: ["bluefin-spot"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const [tokenA, tokenB] = pool.underlyingTokens ?? [];
    if (!tokenA || !tokenB) return null;
    const feePercent = feePercentFromPoolMeta(pool.poolMeta ?? "");
    if (feePercent === null) return null;

    const rows = await fetchPoolRows(ctx);
    const match = rows.find((r) => {
      if (r.is_paused) return false;
      const a = r.tokenA?.info?.address;
      const b = r.tokenB?.info?.address;
      if (!r.address || !a || !b) return false;
      const rowFeePercent = Number(r.feeRate);
      if (!Number.isFinite(rowFeePercent)) return false;
      if (Math.abs(rowFeePercent - feePercent) > FEE_EPSILON) return false;
      const normA = `0x${a.replace(/^0x/, "")}`;
      const normB = `0x${b.replace(/^0x/, "")}`;
      const sameOrder =
        eqSuiCoinType(normA, tokenA) && eqSuiCoinType(normB, tokenB);
      const swapped =
        eqSuiCoinType(normA, tokenB) && eqSuiCoinType(normB, tokenA);
      return sameOrder || swapped;
    });
    const matchA = match?.tokenA?.info?.address;
    const matchB = match?.tokenB?.info?.address;
    if (!match?.address || !matchA || !matchB) return null;
    const tickSpacing = Number(match.config?.tickSpacing);
    if (!Number.isFinite(tickSpacing) || tickSpacing <= 0) return null;

    const type = await getSuiObjectType(match.address);
    if (!type) return null;

    return {
      kind: "bluefin-spot-pool",
      pool: match.address,
      coinTypeA: `0x${matchA.replace(/^0x/, "")}`,
      coinTypeB: `0x${matchB.replace(/^0x/, "")}`,
      tickSpacing,
    };
  },
};
