/**
 * Scallop resolver (Sui) — spec §3.1, §5, §7.1 / Phase 3.
 *
 * Scallop is single-market-per-asset-per-chain (one shared `Market` object
 * holds every reserve), so — like Aave on EVM — there's nothing to
 * disambiguate: `(chain=Sui, symbol)` is already unique. The resolver exists to
 * emit a `{ kind: "scallop-market", market, coinType }` target so the pool is
 * AI-agent-executable in-app ("Deposit in-app") rather than falling to the
 * manual path. The existing `ScallopSuiAdapter` already consumes this target
 * (it reads the mutable package/version from its own config; the target only
 * pins the shared `Market` + the per-asset `coinType`).
 *
 * `coinType` is the immutable per-asset identity (pinned, the backend twin of
 * `scallop.config.ts`'s `SCALLOP_COINS`); the shared `Market` object id is
 * fetched from Scallop's plain address API with a pinned fallback ("config not
 * constants", §3.1). Validate the Market object exists on-chain before trusting.
 *
 * Fail closed: unknown asset / unreadable Market → `null` → manual.
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

const ADDRESS_TTL_SEC = 30 * 60;
/** Scallop's mainnet "address set" id (same one `scallop.config.ts` uses). */
const SCALLOP_ADDRESS_API =
  "https://sui.apis.scallop.io/addresses/67c44a103fe1b8c454eb9699";

/** Pinned per-asset coinTypes — the backend twin of mobile `SCALLOP_COINS`. */
const SCALLOP_COINS: Record<string, string> = {
  SUI: "0x2::sui::SUI",
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  USDT: "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT",
};

/** Pinned fallback for the shared `Market` object (verified 2026-07-03). */
const FALLBACK_MARKET =
  "0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9";

interface ScallopAddressPayload {
  mainnet?: { core?: { market?: string } };
}

async function fetchMarket(ctx: ResolverContext): Promise<string> {
  const res = await ctx.fetchJsonCached<ScallopAddressPayload>(
    "defillama:targets:scallop:addresses:v1",
    SCALLOP_ADDRESS_API,
    ADDRESS_TTL_SEC,
  );
  return res?.mainnet?.core?.market ?? FALLBACK_MARKET;
}

export const ScallopResolver: PoolTargetResolver = {
  family: "scallop",
  aliases: ["scallop-lend", "scallop"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;

    const coinType = SCALLOP_COINS[(pool.symbol ?? "").toUpperCase()];
    if (!coinType) return null;
    // Cross-check the pool's underlying (when present) against the pinned type.
    const underlying = pool.underlyingTokens?.[0];
    if (underlying && !eqSuiCoinType(underlying, coinType)) return null;

    const market = await fetchMarket(ctx);
    const target: DepositTarget = { kind: "scallop-market", market, coinType };

    // Validation (§3.2): the shared Market object is readable on-chain. It's one
    // object for all reserves (no per-coin type param to check), so existence is
    // the meaningful signal; the coinType is pinned + cross-checked above.
    if (suiValidationEnabled()) {
      const type = await getSuiObjectType(market);
      if (!type) return null;
    }
    return target;
  },
};
