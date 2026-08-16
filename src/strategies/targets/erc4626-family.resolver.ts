/**
 * Tier 1 — widening the ERC-4626 funnel (spec §4).
 *
 * **No new adapter, no new kind.** Every protocol here is a native ERC-4626
 * vault, so the whole job is turning the DeFiLlama pool's matching keys into
 * `{ kind:"erc4626", vault, asset }` and letting the shipped `Erc4626Adapter`
 * execute it. Two resolver shapes cover the catalog:
 *
 *  1. **Pinned** (`pinnedVaultResolver`) — protocols with exactly ONE canonical
 *     savings vault per token per chain (Sky/Spark `sUSDS`/`sDAI`, Origin's
 *     wrapped tokens). The address IS the identity, so it comes from the
 *     reviewed address-book and no third party is consulted at all.
 *
 *  2. **Discovered** (`discoveredVaultResolver`) — multi-vault protocols
 *     (Euler EVK evaults, Fluid `fToken`s, Gearbox v3 passive pools, Concrete,
 *     Venus's ERC-4626 wrappers). §12 Q1 decided these need **no bespoke
 *     gating**: a candidate is admitted iff `validateErc4626` passes
 *     (`asset()` matches, the 4626 selector set responds, TVL band). So the
 *     resolver only has to produce a candidate address — the on-chain proof is
 *     the verification, and it is stronger than any allowlist we could write.
 *
 * Both fail closed to `null` → Manual (§8.2). Neither introduces a `switch` on
 * `pool.project`: a new 4626 protocol is one `registerResolver` line with its
 * slugs, nothing else.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { pinnedVaults } from "./address-book";
import { candidateAddressForPool } from "./candidates/registry";
import type {
  Address,
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

/**
 * A protocol whose vaults are pinned in the address-book. Matching is
 * `(chain, underlyingTokens[0])` against the book — a pool for a token the
 * protocol has no reviewed vault for resolves to nothing.
 */
function pinnedVaultResolver(config: {
  family: string;
  aliases: readonly string[];
  /** Address-book key; defaults to `family`. */
  book?: string;
}): PoolTargetResolver {
  const bookKey = config.book ?? config.family;
  return {
    family: config.family,
    aliases: config.aliases,
    async resolve(pool, ctx): Promise<DepositTarget | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) return null;
      const underlying = underlyingOf(pool);
      if (!underlying) return null;

      const candidates = pinnedVaults(bookKey, chainId).filter((v) =>
        eqAddr(v.asset, underlying),
      );
      // Exactly one reviewed vault for this token, or we cannot be confident.
      if (candidates.length !== 1) return null;

      const target: DepositTarget = {
        kind: "erc4626",
        vault: candidates[0].vault.toLowerCase() as Address,
        asset: underlying as Address,
      };
      return (await ctx.validate(target, pool)) ? target : null;
    },
  };
}

/**
 * A multi-vault ERC-4626 protocol with no registry we can stand behind. The
 * candidate address comes from DeFiLlama's legacy pool id
 * (`defillama-pool-address.ts`) and is admitted only by on-chain proof.
 *
 * `minTvlUsd` is a cheap pre-filter, not a safety control — the real gate is
 * `ctx.validate`. It keeps dust pools out of the RPC budget.
 */
function discoveredVaultResolver(config: {
  family: string;
  aliases: readonly string[];
  minTvlUsd?: number;
}): PoolTargetResolver {
  const minTvl = config.minTvlUsd ?? 0;
  return {
    family: config.family,
    aliases: config.aliases,
    async resolve(
      pool: DeFiLlamaYieldPool,
      ctx: ResolverContext,
    ): Promise<DepositTarget | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) return null;
      const underlying = underlyingOf(pool);
      if (!underlying) return null;
      if (pool.tvlUsd < minTvl) return null;

      const vault = await candidateAddressForPool(pool, ctx);
      if (!vault) return null;

      const target: DepositTarget = {
        kind: "erc4626",
        vault,
        asset: underlying as Address,
      };
      // §12 Q1: the validator IS the verification. A vault that is not really
      // 4626, or whose asset() disagrees with the pool's underlying, fails
      // here and the pool keeps its honest "Manual" badge.
      return (await ctx.validate(target, pool)) ? target : null;
    },
  };
}

// ── Pinned single-vault savings protocols ──────────────────────────────────

/**
 * Sky Savings — `sUSDS` is the Sky Savings Rate token. Stablecoin-native, so it
 * lines up with the product's payments thesis rather than being yet another
 * yield venue.
 */
export const SkySavingsResolver = pinnedVaultResolver({
  family: "sky",
  aliases: ["sky-lending", "sky", "makerdao", "maker-dsr", "sky-savings"],
  book: "sky",
});

/**
 * Spark savings — exposes the SAME `sUSDS`/`sDAI` contracts Sky does
 * (docs.spark.fi: "ERC-4626 representation of USDS/DAI"), so it shares the
 * book. SparkLend (the Aave-v3-fork money market) is a different product and
 * resolves through the Family-B fork resolver instead.
 */
export const SparkSavingsResolver = pinnedVaultResolver({
  family: "spark-savings",
  aliases: ["spark-savings", "spark-dai", "susds", "sdai"],
  book: "spark",
});

/** Origin — only the wrapped, non-rebasing receipts are 4626. */
export const OriginResolver = pinnedVaultResolver({
  family: "origin",
  aliases: ["origin-dollar", "origin-ether", "origin-defi", "origin"],
  book: "origin",
});

// ── Multi-vault 4626 protocols admitted by on-chain proof (§12 Q1) ─────────

/** Euler v2 — EVK "EVaults are (mostly) standard-conforming ERC-4626". */
export const EulerResolver = discoveredVaultResolver({
  family: "euler",
  aliases: ["euler-v2", "euler", "eulerv2", "euler-finance"],
  minTvlUsd: 250_000,
});

/** Fluid lending — supply to Liquidity through ERC-4626-compliant `fToken`s. */
export const FluidResolver = discoveredVaultResolver({
  family: "fluid",
  aliases: ["fluid-lending", "fluid", "instadapp-fluid", "fluid-dex-lite"],
  minTvlUsd: 250_000,
});

/** Gearbox v3 — the passive LP side of a credit pool is 4626. */
export const GearboxResolver = discoveredVaultResolver({
  family: "gearbox",
  aliases: ["gearbox", "gearbox-v3", "gearbox-passive"],
  minTvlUsd: 250_000,
});

/** Concrete — capital-allocator vaults; 4626 conformance proven on-chain. */
export const ConcreteResolver = discoveredVaultResolver({
  family: "concrete",
  aliases: ["concrete", "concrete-earn"],
  minTvlUsd: 250_000,
});

/**
 * Venus's ERC-4626 wrapper vaults. §12 Q3: **prefer the wrapper** over the raw
 * `vToken` when one exists, because it reuses the hardened 4626
 * adapter/validator instead of the bespoke Compound-v2 path. Registered ahead
 * of the `compound-v2` Venus resolver so the wrapper is tried first; when no
 * wrapper exists for a market this returns null and the cToken resolver takes
 * over.
 */
export const Venus4626Resolver = discoveredVaultResolver({
  family: "venus-4626",
  // Shares Venus's DeFiLlama slugs on purpose: both resolvers claim the same
  // pools, and registration order decides which is tried first.
  aliases: [
    "venus-erc4626",
    "venus-4626",
    "venus-core-pool",
    "venus-isolated-pools",
    "venus",
  ],
  minTvlUsd: 250_000,
});

/**
 * Curve LlamaLend — its LENDING vaults are ERC-4626, unlike Curve's LP pools
 * (which are Family G / `curve-lp`). Same protocol name, different family:
 * routing by the pool's actual ABI rather than the brand is the whole point of
 * the family model.
 */
export const CurveLlamaLendResolver = discoveredVaultResolver({
  family: "curve-llamalend",
  aliases: ["curve-llamalend", "llamalend"],
  minTvlUsd: 250_000,
});

/** Every Tier-1 Family-A resolver, in registration order. */
export const TIER1_ERC4626_RESOLVERS: readonly PoolTargetResolver[] = [
  SkySavingsResolver,
  SparkSavingsResolver,
  OriginResolver,
  EulerResolver,
  FluidResolver,
  GearboxResolver,
  ConcreteResolver,
  Venus4626Resolver,
  CurveLlamaLendResolver,
];
