/**
 * Current Finance resolver (Sui) — spec §3.1, §5, §7.1 / Phase 3. Found +
 * built 2026-08-22. DEPOSIT-ONLY — see `types.ts`'s `current-market` entry
 * for why withdraw stays unbuilt (a genuine live-Pyth requirement, not a
 * resolver gap).
 *
 * Current is an isolated-market money market (5 markets: MainMarket,
 * AltCoinMarket, EmberMarket, MatrixGoldMarket, EthenaMarket — each its own
 * `Market<M>` object with its own risk params), so `(chain=Sui,
 * underlyingTokens[0])` alone is NOT unique — `pool.poolMeta` (the market
 * name, exactly as Current's own API names it) is the required disambiguator,
 * the same shape as Ember's poolMeta-based sibling matching.
 *
 * Source = Current's own public HTTPS API (`api.current.finance/market/
 * getMarketList`, the same one `DefiLlama/yield-server`'s adaptor calls, §3.1:
 * prefer the plain endpoint over an SDK — Current ships no SDK/MVR entry
 * anyway). Live-fetched per market (not pinned): a row directly carries both
 * the market id AND the reserve coinType, so this doubles as validation — no
 * separate on-chain existence probe is needed beyond confirming the Market
 * object itself is readable.
 *
 * `app` (ProtocolApp, spec §3.1 "immutable identity") is pinned: it's a
 * stable shared object that does not move on a package upgrade — only the
 * moveCall PACKAGE does, which is why it lives in the mobile adapter's config
 * (`current.config.ts`), not here.
 *
 * Fail closed: no market-name match / no coinType match in that market's live
 * list / unreadable Market object → `null` → manual.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { eqSuiCoinType, getSuiObjectType } from "./sui-rpc";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const MARKET_API = "https://api.current.finance/market/getMarketList";
const MARKET_LIST_TTL_SEC = 30 * 60;

/** The type-defining package for `market_type::<Name>` — immutable (spec §3.1). */
const TYPE_PKG =
  "0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf";
/** `app::ProtocolApp` — stable shared object, verified 2026-08-22. */
const PROTOCOL_APP =
  "0xd4395f77a48f6d64af2008280c8dc06ee0fe69953a141e683935f6086d849177";

/** Current's own isolated-market names (verified against the live API 2026-08-22). */
const MARKET_NAMES = [
  "MainMarket",
  "AltCoinMarket",
  "EmberMarket",
  "MatrixGoldMarket",
  "EthenaMarket",
] as const;

interface CurrentMarketRow {
  marketID?: string;
  token?: string; // bare (no 0x) coinType
  name?: string;
}

interface CurrentMarketListPayload {
  data?: { content?: CurrentMarketRow[] };
}

async function fetchMarketRows(
  ctx: ResolverContext,
  marketName: string,
): Promise<CurrentMarketRow[]> {
  const res = await ctx.fetchJsonCached<CurrentMarketListPayload>(
    `defillama:targets:current:market:${marketName}:v1`,
    `${MARKET_API}?marketType=${marketName}&page=1&size=100`,
    MARKET_LIST_TTL_SEC,
  );
  return res?.data?.content ?? [];
}

export const CurrentResolver: PoolTargetResolver = {
  family: "current",
  aliases: ["current"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const underlying = pool.underlyingTokens?.[0];
    if (!underlying) return null;

    // poolMeta carries the market name verbatim (Current's own `pool.name`,
    // per its yield-server adaptor) — mandatory: with 5 isolated markets, a
    // bare coinType match is ambiguous by construction.
    const marketName = (pool.poolMeta ?? "").trim();
    if (!MARKET_NAMES.includes(marketName as (typeof MARKET_NAMES)[number])) {
      return null;
    }

    const rows = await fetchMarketRows(ctx, marketName);
    const match = rows.find(
      (r) => r.token && eqSuiCoinType(`0x${r.token}`, underlying),
    );
    if (!match?.marketID) return null;

    const type = await getSuiObjectType(match.marketID);
    if (!type) return null;

    return {
      kind: "current-market",
      app: PROTOCOL_APP,
      market: match.marketID,
      marketType: `${TYPE_PKG}::market_type::${marketName}`,
      coinType: `0x${match.token}`,
    };
  },
};
