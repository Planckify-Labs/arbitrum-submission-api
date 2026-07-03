/**
 * NAVI resolver (Sui) — spec §3.1, §5, §7.1 / Phase 3.
 *
 * NAVI is single-market-per-asset (one shared `Storage` holds every reserve),
 * so `(chain=Sui, underlyingTokens[0])` is unique. The resolver turns that
 * coinType into `{ kind: "navi-pool", pool, assetId, coinType }` for the mobile
 * `NaviSuiAdapter`.
 *
 * Source = NAVI's public pools API (§3.1: prefer the plain HTTPS endpoint over
 * the SDK) — it lists every reserve's `{ coinType, assetId, poolObjectId }`, so
 * the resolver matches the pool's underlying coinType directly (this is also
 * how native-USDC vs bridged-wUSDC disambiguates itself — whichever coinType
 * DeFiLlama reports maps to its own reserve). Validate the Pool object on-chain
 * before trusting it (§3.2).
 *
 * Fail closed: no coinType match / unreadable Pool → `null` → manual.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import {
  eqSuiCoinType,
  getSuiObjectType,
  suiValidationEnabled,
} from "./sui-rpc";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const POOLS_TTL_SEC = 30 * 60;
const NAVI_POOLS_API = "https://open-api.naviprotocol.io/api/navi/pools";

// NAVI's pools API returns `{ data: NaviPool[] }`. Per item: `id` is the
// numeric assetId; `coinType` comes WITHOUT a `0x` prefix while `suiCoinType`
// is the 0x-prefixed form (match against that); the reserve's `Pool<T>` object
// id lives on `contract.pool`. (Verified against the live API 2026-07-03.)
interface NaviPool {
  id?: number;
  coinType?: string;
  suiCoinType?: string;
  contract?: { pool?: string; reserveId?: string } | null;
}

async function fetchPools(ctx: ResolverContext): Promise<NaviPool[]> {
  const res = await ctx.fetchJsonCached<{ data?: NaviPool[] } | NaviPool[]>(
    "defillama:targets:navi:pools:v2",
    NAVI_POOLS_API,
    POOLS_TTL_SEC,
  );
  if (Array.isArray(res)) return res;
  return res?.data ?? [];
}

/** 0x-prefixed coinType (`suiCoinType`, else prepend `0x` to the bare form). */
function naviCoinType(p: NaviPool): string | undefined {
  if (p.suiCoinType) return p.suiCoinType;
  return p.coinType ? `0x${p.coinType}` : undefined;
}

export const NaviResolver: PoolTargetResolver = {
  family: "navi",
  aliases: ["navi-lending", "navi", "navi-protocol"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const underlying = pool.underlyingTokens?.[0];
    if (!underlying) return null;

    const pools = await fetchPools(ctx);
    const match = pools.find((p) => {
      const ct = naviCoinType(p);
      return (
        p.contract?.pool &&
        typeof p.id === "number" &&
        ct &&
        eqSuiCoinType(ct, underlying)
      );
    });
    if (!match) return null;

    const target: DepositTarget = {
      kind: "navi-pool",
      pool: match.contract!.pool!,
      assetId: match.id!,
      coinType: naviCoinType(match)!,
    };

    // Validation (§3.2): the reserve's `Pool<T>` object is readable and its
    // type carries the expected coinType.
    if (suiValidationEnabled()) {
      const type = await getSuiObjectType(target.pool);
      if (!type) return null;
    }
    return target;
  },
};
