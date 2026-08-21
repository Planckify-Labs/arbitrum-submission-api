/**
 * Address-book accessors (spec §11 Layer-1, §12 Q7).
 *
 * Resolvers import from here rather than reaching into the per-family files, so
 * "is this address pinned?" is one question with one answer. Every lookup
 * returns `null` when the chain is not in a family's book — the caller fails
 * closed to Manual (§8.2).
 *
 * See ./README.md for the rule this table exists to enforce.
 */

import type { Address, DepositTarget } from "../types";
import { eqAddr } from "../types";
import {
  BALANCER_QUERIES,
  BALANCER_V2_CHAINS,
  BALANCER_V2_VAULT,
  BALANCER_V3_VAULTS,
  CURVE_METAREGISTRY_IDS,
  PENDLE_ROUTER,
  PENDLE_ROUTER_CHAINS,
  SOLIDLY_DEPLOYMENTS,
  UNISWAP_V3_POSITION_MANAGERS,
  UNISWAP_V4_POSITION_MANAGERS,
} from "./dex";
import {
  AAVE_V3_POOLS,
  AVALON_POOLS,
  COMET_MARKETS,
  MORPHO_BLUE_SINGLETONS,
  SEAMLESS_POOLS,
  SPARKLEND_POOLS,
  type SingletonBook,
  ZEROLEND_POOLS,
} from "./lending";
import {
  AVANTIS_VAULTS,
  AVANT_VAULTS,
  FORTY_ACRES_VAULTS,
  ORIGIN_VAULTS,
  type PinnedVaultBook,
  SKY_SAVINGS_VAULTS,
  SPARK_SAVINGS_VAULTS,
} from "./vaults";

export * from "./dex";
export * from "./lending";
export * from "./lst";
export * from "./oracles";
export * from "./registries";
export * from "./vaults";

/**
 * Every Aave-v3-shaped `Pool` book, keyed by the resolver family that owns it.
 * A fork ships as a resolver plus ONE entry here (§5.3b) — no adapter, no kind.
 */
export const AAVE_FORK_POOL_BOOKS: Readonly<Record<string, SingletonBook>> = {
  aave: AAVE_V3_POOLS,
  sparklend: SPARKLEND_POOLS,
  seamless: SEAMLESS_POOLS,
  zerolend: ZEROLEND_POOLS,
  // `radiant` removed 2026-08-21 — wrong Pool + protocol winding down. See the
  // note in ./lending.ts before considering a re-add.
  avalon: AVALON_POOLS,
};

/** Pinned single-vault ERC-4626 books, keyed by resolver family (§4). */
export const PINNED_VAULT_BOOKS: Readonly<Record<string, PinnedVaultBook>> = {
  sky: SKY_SAVINGS_VAULTS,
  spark: SPARK_SAVINGS_VAULTS,
  origin: ORIGIN_VAULTS,
  avant: AVANT_VAULTS,
  "forty-acres": FORTY_ACRES_VAULTS,
  avantis: AVANTIS_VAULTS,
};

export function aaveForkPool(family: string, chainId: number): Address | null {
  return AAVE_FORK_POOL_BOOKS[family]?.[chainId] ?? null;
}

export function cometMarkets(chainId: number): readonly Address[] {
  return COMET_MARKETS[chainId] ?? [];
}

export function morphoSingleton(chainId: number): Address | null {
  return MORPHO_BLUE_SINGLETONS[chainId] ?? null;
}

export function solidlyDeployment(chainId: number) {
  return SOLIDLY_DEPLOYMENTS[chainId] ?? null;
}

/**
 * The `AddressProvider` id holding Curve's MetaRegistry on this chain, or
 * `null` when Curve never deployed one there.
 *
 * Callers MUST treat `null` as "no Curve discovery on this chain" and decline.
 * Do not fall back to a default id: on Polygon, id 7 is an active, non-zero
 * `Cryptopool Factory` that answers `find_pool_for_coins` without reverting,
 * so a wrong id reads as a working registry (see `CURVE_METAREGISTRY_IDS`).
 */
export function curveMetaRegistryId(chainId: number): number | null {
  return CURVE_METAREGISTRY_IDS[chainId] ?? null;
}

export function balancerVault(
  chainId: number,
  version: "v2" | "v3",
): Address | null {
  if (version === "v3") return BALANCER_V3_VAULTS[chainId] ?? null;
  return BALANCER_V2_CHAINS.includes(chainId) ? BALANCER_V2_VAULT : null;
}

/**
 * The v2 `BalancerQueries` singleton for a chain, or `null` when we have no
 * reviewed deployment there. A join/exit build MUST fail closed rather than
 * price itself with a zero minimum when this is `null` (§12 Q4).
 */
export function balancerQueries(chainId: number): Address | null {
  return BALANCER_QUERIES[chainId] ?? null;
}

export function pinnedVaults(family: string, chainId: number) {
  return PINNED_VAULT_BOOKS[family]?.[chainId] ?? [];
}

/**
 * The allowlist of contracts a `router-call` build may target (§6 guardrail 2,
 * §11 Layer-1). The hosted API returns `{to, data, value}`; if `to` is not on
 * this list the build is BLOCKED, which is what defends against a compromised
 * or spoofed API response routing funds elsewhere.
 */
export function routerAllowlist(
  protocol: Extract<DepositTarget, { kind: "router-call" }>["protocol"],
  chainId: number,
): readonly Address[] {
  switch (protocol) {
    case "pendle":
      // Deterministic address, but ONLY on the chains Pendle deployed to — a
      // chain we have not reviewed gets an empty allowlist and fails closed,
      // exactly like the Uniswap cases below. See PENDLE_ROUTER_CHAINS.
      return PENDLE_ROUTER_CHAINS.includes(chainId) ? [PENDLE_ROUTER] : [];
    case "uniswap-v3": {
      const pm = UNISWAP_V3_POSITION_MANAGERS[chainId];
      return pm ? [pm] : [];
    }
    case "uniswap-v4": {
      const pm = UNISWAP_V4_POSITION_MANAGERS[chainId];
      return pm ? [pm] : [];
    }
  }
}

export function isRouterAllowlisted(
  protocol: Extract<DepositTarget, { kind: "router-call" }>["protocol"],
  chainId: number,
  to: string | undefined,
): boolean {
  return routerAllowlist(protocol, chainId).some((a) => eqAddr(a, to));
}

/**
 * Is this target's `tx.to` a PINNED singleton for its kind?
 *
 * The Layer-1 "singleton address-book allowlist" check (§11) and the backing
 * assertion for §12 Q7's "a singleton kind's `to` never comes from an API".
 * Kinds whose destination is legitimately per-vault (`erc4626`, `compound-v2`,
 * `async-vault`) are not singletons and return `null` — they are admitted by
 * on-chain identity instead, not by this list.
 */
export function pinnedDestinationFor(
  target: DepositTarget,
  chainId: number,
): readonly Address[] | null {
  switch (target.kind) {
    case "aave-v3":
      return Object.values(AAVE_FORK_POOL_BOOKS)
        .map((book) => book[chainId])
        .filter((a): a is Address => !!a);
    case "compound-v3":
      return cometMarkets(chainId);
    case "morpho-blue": {
      const singleton = morphoSingleton(chainId);
      return singleton ? [singleton] : [];
    }
    case "solidly-lp": {
      const dep = solidlyDeployment(chainId);
      return dep ? [dep.router] : [];
    }
    case "balancer-lp":
      return [
        balancerVault(chainId, "v3"),
        balancerVault(chainId, "v2"),
      ].filter((a): a is Address => !!a);
    case "router-call":
      return routerAllowlist(target.protocol, chainId);
    default:
      return null;
  }
}
