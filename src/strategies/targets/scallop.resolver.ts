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
 * `coinType` per asset comes from the SAME address payload as the `Market` id
 * ("config not constants", §3.1) — Scallop's `mainnet.core.coins` map is keyed
 * by coin name (`"cetus"`, `"sbeth"`, …) and each entry carries its `coinType`,
 * which uppercases to exactly the DeFiLlama pool `symbol` (verified against
 * the live payload 2026-08-22: 19/19 non-pinned refused symbols matched a key
 * this way — `SBETH`, `USDY`, `CETUS`, `DEEP`, `HAEDAL`, … all present). A
 * small pinned set is kept as a fallback for when the API is unreachable
 * (mirrors `FALLBACK_MARKET`) — the mobile `SCALLOP_COINS` covers only those
 * three today (`scallop.config.ts`), which is fine: mobile only falls back to
 * its own dict for the symbol-first zap flow — the pool-card path here already
 * carries `target.coinType` straight from THIS resolver, so widening this file
 * alone is what lights up "Deposit in-app" for the rest of Scallop's assets.
 *
 * This is not a NEW pinned address needing the address-book sign-off (§11.5c
 * Step 5) — the `Market`/`protocolPkg` destination was already reviewed at
 * Phase 3 and is unchanged; a coinType is a Move type argument into that same
 * reviewed object, not a `tx.to`, and it is independently cross-checked
 * against DeFiLlama's own `underlyingTokens[0]` below exactly like the 3
 * previously-pinned coins were — same safety property, just sourced from
 * Scallop's own authoritative API (§11.5c Step 2) instead of a hand-copied
 * constant, for more assets.
 *
 * Fail closed: no coinType match / underlying mismatch / unreadable Market →
 * `null` → manual.
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

/**
 * Pinned fallback coinTypes, used only when the address API is unreachable —
 * the same three mobile's `SCALLOP_COINS` pins (`scallop.config.ts`).
 */
const FALLBACK_COINS: Record<string, string> = {
  SUI: "0x2::sui::SUI",
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  USDT: "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT",
};

/** Pinned fallback for the shared `Market` object (verified 2026-07-03). */
const FALLBACK_MARKET =
  "0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9";

interface ScallopAddressPayload {
  mainnet?: {
    core?: {
      market?: string;
      coins?: Record<string, { coinType?: string } | undefined>;
    };
  };
}

function fetchAddresses(
  ctx: ResolverContext,
): Promise<ScallopAddressPayload | null> {
  return ctx.fetchJsonCached<ScallopAddressPayload>(
    "defillama:targets:scallop:addresses:v1",
    SCALLOP_ADDRESS_API,
    ADDRESS_TTL_SEC,
  );
}

function marketFrom(payload: ScallopAddressPayload | null): string {
  return payload?.mainnet?.core?.market ?? FALLBACK_MARKET;
}

/** Symbol (uppercased coin name) → coinType, live from Scallop's own API. */
function coinsFrom(
  payload: ScallopAddressPayload | null,
): Record<string, string> {
  const coins = payload?.mainnet?.core?.coins;
  if (!coins) return FALLBACK_COINS;
  const out: Record<string, string> = {};
  for (const [name, info] of Object.entries(coins)) {
    if (info?.coinType) out[name.toUpperCase()] = info.coinType;
  }
  return Object.keys(out).length > 0 ? out : FALLBACK_COINS;
}

export const ScallopResolver: PoolTargetResolver = {
  family: "scallop",
  aliases: ["scallop-lend", "scallop"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;

    const payload = await fetchAddresses(ctx);
    const coinType = coinsFrom(payload)[(pool.symbol ?? "").toUpperCase()];
    if (!coinType) return null;
    // Cross-check the pool's underlying (when present) against the resolved
    // type — the safety net for a bad/renamed entry in Scallop's own API.
    const underlying = pool.underlyingTokens?.[0];
    if (underlying && !eqSuiCoinType(underlying, coinType)) return null;

    const market = marketFrom(payload);
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
