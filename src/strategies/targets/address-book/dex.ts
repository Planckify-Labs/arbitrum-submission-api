/**
 * Pinned DEX / router deployments (Families G, spec §5.3, §6, §6.1, §6.2).
 *
 * This is the highest-risk table in the address book. The router-calldata
 * families (§6) execute bytes we did not author, and the ONLY thing standing
 * between a spoofed API response and a `tx.to` that drains a wallet is the
 * allowlist below (§11 Layer-1, §12 Q7). See ./README.md before editing.
 */

import type { Address } from "../types";

/**
 * Curve's `AddressProvider` — the same deterministic address on every chain
 * Curve deploys to. Everything else (MetaRegistry, the pool list) is read
 * FROM it on-chain, so no per-pool address is ever taken from an API.
 */
export const CURVE_ADDRESS_PROVIDER =
  "0x0000000022D53366457F9d5E68Ec105046FC4383" as Address;

/** `AddressProvider.get_address(id)` slot for the MetaRegistry. */
export const CURVE_METAREGISTRY_ID = 7;

/**
 * Pendle Router v4 — one deterministic address across every supported chain.
 * A `router-call` build whose returned `to` is not this address is BLOCKED
 * (§6 guardrail 2).
 */
export const PENDLE_ROUTER =
  "0x888888888889758F76e7103c6CbF23ABbF58F946" as Address;

/** Pendle's hosted SDK origin. Only ever called from the backend proxy (§6). */
export const PENDLE_HOSTED_SDK_ORIGIN = "https://api-v2.pendle.finance";

/**
 * Uniswap position managers — the `to` an LP mint/increase lands on. v3 uses
 * the NonfungiblePositionManager; v4 the PositionManager.
 */
export const UNISWAP_V3_POSITION_MANAGERS: Readonly<Record<number, Address>> = {
  1: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  10: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  137: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  42161: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  8453: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
};

export const UNISWAP_V4_POSITION_MANAGERS: Readonly<Record<number, Address>> = {
  1: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
  8453: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
};

/**
 * Solidly-fork routers (§6.1). `addLiquidity(...)` with a mandatory
 * `minA`/`minB` + `deadline`; the router MUST be pinned, never read from the
 * protocol's API.
 */
export interface SolidlyDeployment {
  readonly router: Address;
  readonly factory: Address;
  readonly label: string;
}

export const SOLIDLY_DEPLOYMENTS: Readonly<Record<number, SolidlyDeployment>> =
  {
    // Aerodrome (Base)
    8453: {
      router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
      factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
      label: "Aerodrome",
    },
    // Velodrome v2 (Optimism)
    10: {
      router: "0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858",
      factory: "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a",
      label: "Velodrome v2",
    },
  };

/**
 * Balancer Vaults (§6.2). v3 introduced a new Vault + Router; v2 (which Beets
 * and most existing pools still use) keeps the long-standing singleton.
 */
export const BALANCER_V2_VAULT =
  "0xBA12222222228d8Ba445958a75a0704d566BF2C8" as Address;

export const BALANCER_V3_VAULTS: Readonly<Record<number, Address>> = {
  1: "0xbA1333333333a1BA1108E8412f11850A5C319bA9",
  8453: "0xbA1333333333a1BA1108E8412f11850A5C319bA9",
};

/**
 * Chains where the Balancer v2 Vault singleton is deployed. Pinned as a set
 * rather than assumed-everywhere so a chain we have not reviewed fails closed.
 */
export const BALANCER_V2_CHAINS: readonly number[] = [
  1, 10, 137, 8453, 42161, 43114, 100, 146,
];
