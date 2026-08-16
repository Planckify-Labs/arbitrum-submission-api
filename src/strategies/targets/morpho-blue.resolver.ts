/**
 * Tier 2 — Morpho Blue direct (isolated) markets (spec §5.2, §3.1).
 *
 * This is the family the union's **correctness fix** exists for. The declared
 * `{ kind:"morpho-blue"; marketId }` could never build a transaction:
 * `supply`/`withdraw` on the singleton take the full `MarketParams` struct, and
 * `marketId = keccak256(abi.encode(params))` is a one-way hash. So the resolver
 * fetches the whole struct from Morpho's own API and the validator re-derives
 * the hash before anything is trusted — if the API returned a struct that does
 * not hash to the id it claims, the target is rejected (§5.2, §11 Layer-1).
 *
 * **Lender-only.** We supply; we never open a borrow. Even so, a lender
 * inherits the market's bad-debt risk through its oracle, so only markets whose
 * `oracle` and `irm` are on the reviewed allowlist resolve (§12 Q6).
 */

import { morphoSingleton } from "./address-book";
import { isMorphoRiskAllowlisted } from "./morpho-allowlist";
import type {
  Address,
  DepositTarget,
  Hex,
  MorphoMarketParams,
  PoolTargetResolver,
  ResolverContext,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

const MARKET_LIST_TTL_SEC = 30 * 60;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

interface MorphoMarket {
  marketId?: string;
  lltv?: string | number;
  oracle?: { address?: string } | null;
  irmAddress?: string | null;
  listed?: boolean;
  loanAsset?: { address?: string } | null;
  collateralAsset?: { address?: string } | null;
  state?: { supplyAssetsUsd?: number | null } | null;
}

/**
 * Field names track Morpho's live schema, which HAS moved under us: it used to
 * be `uniqueKey` / `whitelisted` / `oracleAddress`, and is now
 * `marketId` / `listed` / `oracle { address }`. That rename silently disabled
 * the whole family — a rejected query returns `errors` with no `data`, which
 * read as "this chain has no markets" and every pool degraded to Manual.
 *
 * `external-api-drift.spec.ts` now fails when this query stops validating, so
 * the next rename is caught as a failing check instead of as a family that
 * quietly stops resolving.
 */
const MARKETS_QUERY = `query Markets($chainId: Int!) {
  markets(first: 1000, where: { chainId_in: [$chainId] }) {
    items {
      marketId
      lltv
      oracle { address }
      irmAddress
      listed
      loanAsset { address }
      collateralAsset { address }
      state { supplyAssetsUsd }
    }
  }
}`;

/** Exported so the drift spec asserts the EXACT query the resolver sends. */
export const MORPHO_MARKETS_QUERY = MARKETS_QUERY;

interface MorphoGraphqlResponse {
  data?: { markets?: { items?: MorphoMarket[] } };
  errors?: Array<{ message?: string }>;
}

async function fetchMorphoMarkets(
  chainId: number,
  ctx: ResolverContext,
): Promise<MorphoMarket[]> {
  const res = await ctx.fetchJsonCached<MorphoGraphqlResponse>(
    // Cache key bumped with the query shape: a cached v1 body holds the OLD
    // field names, and serving it would keep the family dark for the TTL.
    `defillama:targets:morpho:markets:${chainId}:v2`,
    "https://api.morpho.org/graphql",
    MARKET_LIST_TTL_SEC,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: MARKETS_QUERY, variables: { chainId } }),
    },
  );
  // A GraphQL error is HTTP 200 with no `data`, so it is indistinguishable from
  // an empty result unless we look. Say so loudly: fail-closed is right, but
  // failing closed SILENTLY for months is how the rename went unnoticed.
  if (res?.errors?.length) {
    console.warn(
      `[morpho-blue] markets query rejected by api.morpho.org (schema drift?): ${res.errors
        .map((e) => e.message ?? "unknown")
        .join("; ")}`,
    );
    return [];
  }
  return res?.data?.markets?.items ?? [];
}

/** Normalise a market label for the poolMeta ↔ marketId disambiguation. */
function normLabel(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toParams(market: MorphoMarket): MorphoMarketParams | null {
  const loanToken = market.loanAsset?.address;
  const oracle = market.oracle?.address;
  const irm = market.irmAddress;
  const lltv = market.lltv;
  if (!loanToken || !oracle || !irm || lltv === undefined || lltv === null)
    return null;
  // `collateralAsset` is legitimately null on an idle market — the struct still
  // needs the zero address there, and the marketId hash depends on it.
  const collateralToken = market.collateralAsset?.address ?? ZERO_ADDRESS;
  return {
    loanToken: loanToken.toLowerCase() as Address,
    collateralToken: collateralToken.toLowerCase() as Address,
    oracle: oracle.toLowerCase() as Address,
    irm: irm.toLowerCase() as Address,
    // Decimal string: the target is a wire type (see MorphoMarketParams).
    lltv: String(lltv),
  };
}

export const MorphoBlueResolver: PoolTargetResolver = {
  family: "morpho-blue-market",
  // Claims the same slug as the MetaMorpho vault resolver. That one is
  // registered first, so a pool that IS a curated vault resolves there and only
  // the direct markets fall through to here (registry ordered fallback).
  aliases: [
    "morpho-blue",
    "morpho-blue-markets",
    "morpho-market",
    "morpho-blue-direct",
  ],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;
    // The singleton must be pinned — it is the `tx.to` for every market.
    if (!morphoSingleton(chainId)) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;

    const markets = await fetchMorphoMarkets(chainId, ctx);
    const candidates = markets.filter(
      (m) =>
        typeof m.marketId === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test(m.marketId) &&
        eqAddr(m.loanAsset?.address, underlying) &&
        m.listed !== false,
    );
    if (candidates.length === 0) return null;

    // Only lender-safe, non-empty markets: a market with no supply side is
    // either brand new or dead, and either way is not somewhere to route funds.
    const supplied = candidates.filter(
      (m) => (m.state?.supplyAssetsUsd ?? 0) > 0,
    );
    const usable = supplied.length > 0 ? supplied : [];
    if (usable.length === 0) return null;

    // Disambiguate siblings the same way the MetaMorpho resolver does: the
    // pool's label against the market id. Morpho's poolMeta for direct markets
    // is typically the marketId prefix or the collateral symbol.
    let match = usable[0];
    if (pool.poolMeta && usable.length > 1) {
      const needle = normLabel(pool.poolMeta);
      const byLabel = usable.find((m) => {
        const key = normLabel(m.marketId);
        const collateral = normLabel(m.collateralAsset?.address);
        return (
          (needle.length > 0 && key.includes(needle)) ||
          (needle.length > 0 && collateral.includes(needle))
        );
      });
      if (!byLabel) return null; // labelled but unmatched ⇒ do not guess
      match = byLabel;
    } else if (usable.length > 1) {
      // Several markets for this loan token and nothing to disambiguate with.
      return null;
    }

    const params = toParams(match);
    if (!params) return null;

    // §12 Q6 — a bad oracle is a lender's bad-debt risk, so an unreviewed
    // oracle/IRM pairing never resolves.
    if (!isMorphoRiskAllowlisted(chainId, params.oracle, params.irm)) {
      return null;
    }

    const target: DepositTarget = {
      kind: "morpho-blue",
      marketId: match.marketId as Hex,
      params,
      asset: params.loanToken,
    };
    // validateMorphoBlue re-derives keccak256(abi.encode(params)) and requires
    // it to equal marketId — this is what closes the "wrong struct" hole.
    return (await ctx.validate(target, pool)) ? target : null;
  },
};
