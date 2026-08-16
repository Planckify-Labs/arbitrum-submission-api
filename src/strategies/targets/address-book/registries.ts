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
 */
export const FLUID_LENDING_RESOLVERS: Readonly<Record<number, Address>> = {
  1: "0xC215485C572365AE87f908ad35233EC2572A3BEC", // Ethereum
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
