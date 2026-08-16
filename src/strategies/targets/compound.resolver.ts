/**
 * Tier 2 — Compound III (Comet) and the Compound-v2 cToken fork lineage
 * (spec §5.1, §5.4).
 *
 * Two families, two kinds, one file because they share a heritage and a
 * catalog neighbourhood:
 *
 *  - **Comet** (`compound-v3`) — `supply(asset,amount)` / `withdraw(asset,amount)`
 *    on a per-base-asset market contract. The cleanest new adapter in the
 *    expansion, and one target shape covers every Comet market on every chain.
 *  - **cToken forks** (`compound-v2`) — `mint`/`redeem`/`redeemUnderlying` with
 *    exchange-rate shares. ONE adapter covers Venus, Benqi, Sonne and the rest
 *    of the lineage.
 *
 * §12 Q3: where a fork also ships an ERC-4626 wrapper (Venus does), the
 * wrapper resolver is registered FIRST and this is the general fallback for
 * markets without one.
 */

import { cometMarkets } from "./address-book";
import { candidateAddressForPool } from "./candidates/registry";
import type { Address, DepositTarget, PoolTargetResolver } from "./types";
import { resolveEvmChainId, underlyingOf } from "./types";

/**
 * Compound III. The Comet set per chain is address-book-pinned (a Comet is a
 * singleton for its base asset, so it may never come from an API — §12 Q7).
 *
 * Which of a chain's Comets serves this pool is decided by ON-CHAIN identity,
 * not by name matching: `validateCompoundV3` reads `comet.baseToken()` and
 * requires it to equal the pool's underlying, so we hand candidates to the
 * validator and take the one that proves out. A chain whose Comets none match
 * resolves to `null` → Manual.
 */
export const CompoundV3Resolver: PoolTargetResolver = {
  family: "compound-v3",
  aliases: [
    "compound-v3",
    "compound",
    "compoundv3",
    "compound-usdc",
    "compound-finance",
  ],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;

    for (const comet of cometMarkets(chainId)) {
      const target: DepositTarget = {
        kind: "compound-v3",
        comet,
        asset: underlying as Address,
      };
      if (await ctx.validate(target, pool)) return target;
    }
    return null;
  },
};

/**
 * Compound-v2 cToken forks. The market's cToken is a PER-MARKET address (not a
 * singleton), so it may come from a discovery source — but only after Layer-1
 * identity proves it: `validateCompoundV2` reads `cToken.underlying()` and
 * requires it to equal the pool's underlying, plus a non-zero exchange rate.
 *
 * `family` doubles as the label; adding another fork is one entry at the bottom
 * of this file.
 */
function cTokenForkResolver(config: {
  family: string;
  aliases: readonly string[];
  minTvlUsd?: number;
}): PoolTargetResolver {
  const minTvl = config.minTvlUsd ?? 0;
  return {
    family: config.family,
    aliases: config.aliases,
    async resolve(pool, ctx): Promise<DepositTarget | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) return null;
      const underlying = underlyingOf(pool);
      if (!underlying) return null;
      if (pool.tvlUsd < minTvl) return null;

      const cToken = await candidateAddressForPool(pool, ctx);
      if (!cToken) return null;

      const target: DepositTarget = {
        kind: "compound-v2",
        cToken,
        asset: underlying as Address,
      };
      return (await ctx.validate(target, pool)) ? target : null;
    },
  };
}

/**
 * Venus core + isolated pools. Registered AFTER `Venus4626Resolver` so a market
 * with a `VenusERC4626` wrapper routes through the hardened 4626 path first
 * (§12 Q3) and this only serves markets without one.
 */
export const VenusResolver = cTokenForkResolver({
  family: "venus",
  aliases: ["venus-core-pool", "venus-isolated-pools", "venus"],
  minTvlUsd: 250_000,
});

export const BenqiLendingResolver = cTokenForkResolver({
  family: "benqi",
  aliases: ["benqi-lending", "benqi"],
  minTvlUsd: 250_000,
});

export const SonneResolver = cTokenForkResolver({
  family: "sonne",
  aliases: ["sonne-finance", "sonne"],
  minTvlUsd: 250_000,
});

export const TIER2_COMPOUND_RESOLVERS: readonly PoolTargetResolver[] = [
  CompoundV3Resolver,
  VenusResolver,
  BenqiLendingResolver,
  SonneResolver,
];
