/**
 * Pinned **registry** contracts — the entry points the candidate sources read
 * to discover a protocol's vaults (see ../candidates/onchain.source.ts).
 *
 * These are pinned under the same rule as any Pool or router (§12 Q7, and
 * ./README.md), and for the same reason: a registry decides WHICH vault a
 * deposit routes into, so whoever can swap the registry can swap the
 * destination. "It is only used for discovery" is not a weaker requirement.
 *
 * Every address here was read on-chain before being written down:
 *   - Euler `GenericFactory.getProxyListLength()` → 877 proxies
 *   - Fluid `LendingResolver.getAllFTokens()` → 7 fTokens
 *   - Multicall3 has code on every chain in the book
 *
 * A chain absent from a map means that protocol is not discoverable there, and
 * the source returns null → the pool degrades to Manual. Never a guess.
 */

import type { Address } from "../types";

/**
 * Multicall3 — the same deterministic deployment on essentially every EVM
 * chain. Only ever used to BATCH read calls, so unlike the other entries here
 * it can never be a `tx.to`; it is pinned anyway because a wrong address would
 * silently return failures for every vault and empty a family's candidate list.
 */
export const MULTICALL3 =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;

/**
 * Euler v2 `GenericFactory` — lists every EVK vault ever deployed on the chain.
 * This is what replaced DeFiLlama `/poolsOld` for Euler after that feed was
 * paywalled: the protocol's own factory cannot be paywalled or go stale.
 */
export const EULER_VAULT_FACTORIES: Readonly<Record<number, Address>> = {
  1: "0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e", // Ethereum
};

/**
 * Fluid `LendingResolver` — `getAllFTokens()` returns the full fToken set, so
 * no enumeration paging is needed.
 *
 * Verified 2026-08-19 against Instadapp's own deployment table
 * (`Instadapp/fluid-deployments`, `deployments.md` → LendingResolver). The
 * mainnet row there matches the address that was already pinned here, which is
 * the corroboration §12 Q7 asks for before trusting the other three. Each entry
 * additionally answers `getAllFTokens()` on chain (1 → 7, 8453 → 6, 42161 → 9,
 * 137 → 6 fTokens).
 *
 * Ethereum-only until now, which is why `fluid-lending` pools on Base and
 * Arbitrum had no candidate source and fell through to Manual despite the
 * family being live — a missing registry reads exactly like "not our pool".
 */
export const FLUID_LENDING_RESOLVERS: Readonly<Record<number, Address>> = {
  1: "0xC215485C572365AE87f908ad35233EC2572A3BEC", // Ethereum
  8453: "0x3aF6FBEc4a2FE517F56E402C65e3f4c3e18C1D86", // Base
  42161: "0xdF4d3272FfAE8036d9a2E1626Df2Db5863b4b302", // Arbitrum
  137: "0x8e72291D5e6f4AAB552cc827fB857a931Fc5CAC1", // Polygon
};

/**
 * Registries deliberately NOT pinned yet, with the reason — kept in code so the
 * gaps read as decisions rather than oversights (§8.2):
 *
 * - **Gearbox** — discovery goes through its `AddressProvider` → `PoolFactory`,
 *   whose accessor is version-keyed (`getAddressOrRevert(key, version)`). The
 *   version is a moving target, so it needs its own reviewed source rather than
 *   the generic vault-enumeration shape here.
 * - **Concrete** — no public registry contract found; its vault list is only
 *   published through an app API, which §12 Q7 will not accept for discovery
 *   that selects a destination.
 * - **Venus 4626 wrappers** — the wrappers are announced per-market rather than
 *   enumerated, so there is nothing to list.
 * - **Compound-v2 forks** (Venus, Benqi, Sonne) — `Comptroller.getAllMarkets()`
 *   IS enumerable and would work, but every chain those forks live on (BSC 56,
 *   Avalanche 43114, Optimism 10) is absent from the `Blockchain` table, so a
 *   source would resolve nothing today. Add the chain row first.
 */
export const REGISTRIES_DEFERRED = [
  "gearbox",
  "concrete",
  "venus-4626",
  "compound-v2-forks",
] as const;

/**
 * Compound-v2 fork `Comptroller`s, keyed by resolver family then chain.
 *
 * These exist so the whole cToken lineage stops depending on DeFiLlama's
 * `/poolsOld` for candidate addresses (§11.6). Every fork keeps Compound's
 * `getAllMarkets()`, so one enumeration serves Venus, Benqi, Moonwell and any
 * future fork — the family already shares a resolver, a validator and an
 * adapter, and now it shares its discovery too.
 *
 * A Comptroller decides which cTokens exist, so whoever can swap it can swap
 * the deposit destination: same pinning rule as any Pool or router. Each entry
 * was verified on chain 2026-08-19 by calling `getAllMarkets()` and getting a
 * non-empty list.
 */
export const COMPOUND_V2_COMPTROLLERS: Readonly<
  Record<string, Readonly<Record<number, Address>>>
> = {
  venus: {
    56: "0xfD36E2c2a6789Db23113685031d7F16329158384", // BNB Chain
  },
  benqi: {
    43114: "0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4", // Avalanche
  },
  moonwell: {
    8453: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C", // Base
  },
  // Compound's OWN v2 markets — the family the forks above were forked FROM.
  // Address is Compound's `Unitroller` proxy from their own deployment file
  // (`compound-finance/compound-protocol`, `networks/mainnet.json`,
  // `Contracts.Comptroller`), verified on chain 2026-08-21: `getAllMarkets()`
  // returns the live market list (cETH 0x4ddc2d19…, cUSDC 0x39aa39c0…,
  // cUSDT 0xf650c3d8…).
  //
  // Keyed "compound-v2" and not "compound" on purpose: the family lookup is a
  // SUBSTRING test against the pool slug, so a bare "compound" key would also
  // claim `compound-v3` pools — a different product with a different adapter.
  "compound-v2": {
    1: "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B",
  },
};
