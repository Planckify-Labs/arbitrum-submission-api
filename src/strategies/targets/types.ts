/**
 * Pool-level deposit resolution — shared types (docs/defi-pool-level-deposits-spec.md §4.1, §5).
 *
 * A DeFiLlama `pool` id is an opaque UUID, NOT an on-chain address.
 * `DepositTarget` is the resolved, on-chain-validated deposit destination a
 * `PoolTargetResolver` turns that UUID into (via the pool's matching keys:
 * project + chain + underlyingTokens + poolMeta). It is a discriminated union
 * keyed by `kind`; the mobile adapter registry routes one target to exactly
 * one adapter by that `kind` (spec §7). `null` = unresolved → the pool degrades
 * to the manual deep-link path (fail-closed, §2.1).
 *
 * This is the BACKEND twin of the mobile `DepositTarget` in
 * `mobile-app/services/defi/types.ts` — keep the two in sync.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type DepositTarget =
  | { kind: "erc4626"; vault: Address; asset: Address }
  | { kind: "aave-v3"; pool: Address; asset: Address }
  | { kind: "morpho-blue"; marketId: Hex }
  | { kind: "compound-v3"; comet: Address; asset: Address }
  | { kind: "curve-lp"; pool: Address; asset: Address; index: number }
  | { kind: "scallop-market"; market: string; coinType: string }
  | { kind: "solana-reserve"; program: string; reserve: string; mint: string };

export type DepositTargetKind = DepositTarget["kind"];

/**
 * One resolver per protocol *family*, registered in the target registry
 * (spec §5). Mirrors the mobile space-docking pattern: adding a protocol is a
 * `registerResolver(...)` call, NEVER a `switch` on project slug.
 *
 * `resolve` MUST fail closed — return `null` (→ manual) whenever it cannot
 * confidently resolve *and* on-chain-validate a target. Never guess an address.
 */
export interface PoolTargetResolver {
  /** Canonical family key (e.g. "morpho", "yearn", "aave"). */
  readonly family: string;
  /**
   * DeFiLlama `project` slugs (and shorthands) this resolver handles, matched
   * case-insensitively against `pool.project`. When omitted, only `family`
   * matches.
   */
  readonly aliases?: readonly string[];
  resolve(
    pool: DeFiLlamaYieldPool,
    ctx: ResolverContext,
  ): Promise<DepositTarget | null>;
}

/**
 * Injected capabilities a resolver needs — kept as an interface so resolvers
 * stay plain, testable functions (no Nest DI inside the family files).
 */
export interface ResolverContext {
  /** TTL-cached, deduped JSON GET (Valkey-backed). Returns `null` on failure. */
  fetchJsonCached<T>(
    cacheKey: string,
    url: string,
    ttlSec: number,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<T | null>;
  /** On-chain validation (spec §3.2). Returns false when it can't confirm. */
  validate(target: DepositTarget, pool: DeFiLlamaYieldPool): Promise<boolean>;
}

// DeFiLlama chain name -> EVM chainId. Non-EVM chains return 0 (they carry a
// namespace discriminator instead). Mirrors CHAIN_NAME_MAP in the score worker.
const EVM_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
};

export function resolveEvmChainId(chainName: string | undefined): number {
  return EVM_CHAIN_IDS[(chainName ?? "").toLowerCase()] ?? 0;
}

/** Lowercased 0x-address compare that tolerates undefined / non-hex. */
export function eqAddr(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** The deposited asset address from `/pools`, lowercased. */
export function underlyingOf(pool: DeFiLlamaYieldPool): string | null {
  const t = pool.underlyingTokens?.[0];
  return typeof t === "string" && /^0x[0-9a-fA-F]{40}$/.test(t)
    ? t.toLowerCase()
    : null;
}
