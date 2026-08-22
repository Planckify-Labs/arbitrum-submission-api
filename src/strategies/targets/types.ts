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

/**
 * Morpho Blue market identity (EVM-protocol-expansion spec §3.1).
 *
 * `supply`/`withdraw` on the Morpho singleton take the FULL struct — the
 * market id is `keccak256(abi.encode(params))`, a one-way hash you cannot
 * invert on-chain, so a target carrying only `marketId` cannot build a
 * transaction. The resolver fills this from Morpho's own API and the
 * validator re-derives the hash before the target is trusted (§5.2).
 *
 * `lltv` is a uint256 **decimal string**, not a bigint: `DepositTarget` is a
 * WIRE type (persisted in `OpportunityCache.depositTarget` as JSON, shipped to
 * mobile over HTTP) and `JSON.stringify` throws on BigInt. Adapters parse it
 * with `BigInt(...)` at build time.
 */
export interface MorphoMarketParams {
  /** The asset a lender supplies (== the pool's underlying). */
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  /** uint256, 1e18-scaled, as a decimal string (JSON-safe). */
  lltv: string;
}

/**
 * Sentinel for "the chain's native coin" in an EVM `asset` field (spec §12 Q5).
 * Native deposits set `value: amount` on the built call and omit
 * `needsApproval` — there is no ERC-20 `approve` for ETH, and emitting one
 * would be a no-op that masks a mis-build.
 */
export const NATIVE_ASSET_SENTINEL =
  "0x0000000000000000000000000000000000000000" as Address;

export type DepositTarget =
  | { kind: "erc4626"; vault: Address; asset: Address }
  | { kind: "aave-v3"; pool: Address; asset: Address }
  // Morpho Blue isolated market on the singleton `Morpho` contract. `marketId`
  // is identity/validation only; `params` is what `supply`/`withdraw` actually
  // take, and `asset` (== params.loanToken) is the deposited token (§3.1).
  | {
      kind: "morpho-blue";
      marketId: Hex;
      params: MorphoMarketParams;
      asset: Address;
    }
  | { kind: "compound-v3"; comet: Address; asset: Address }
  // Compound-v2 cToken forks (Venus vToken, Benqi qiToken, Sonne…). `mint`/
  // `redeem`/`redeemUnderlying` with exchange-rate shares (§5.4). Prefer a
  // protocol's ERC-4626 wrapper (Family A) when one exists — §12 Q3.
  | { kind: "compound-v2"; cToken: Address; asset: Address }
  // Curve LP. `index` is the coin's slot in the pool's `coins[]`; `nCoins` +
  // `isNg` are carried so the adapter picks the right `add_liquidity` arity
  // and index type without an on-chain probe per build (§3.3).
  | {
      kind: "curve-lp";
      pool: Address;
      asset: Address;
      index: number;
      nCoins: 2 | 3 | 4;
      isNg: boolean;
      /**
       * The LP receipt token, when it is NOT the pool contract itself.
       *
       * Curve's NG generation (and every pool this family shipped with before
       * 2026-08-21) mints its LP token AS the pool contract, so `lpToken` is
       * absent and every reader falls back to `pool`. Classic pools (3pool and
       * its lineage) mint a SEPARATE ERC-20 — `pool` has no `balanceOf` at
       * all — so THIS is where a withdraw or a position read must look
       * instead. Read from Curve's own MetaRegistry (`get_lp_token`), never
       * guessed: a wrong value here reads a balance from the wrong contract
       * and a `MAX` withdraw silently burns zero.
       */
      lpToken?: Address;
    }
  // Solidly-fork LP (Aerodrome on Base, Velodrome on OP). Deposits go through
  // the Router's `addLiquidity`; `stable` picks the invariant (§6.1).
  | {
      kind: "solidly-lp";
      router: Address;
      pool: Address;
      token0: Address;
      token1: Address;
      stable: boolean;
    }
  // Uniswap v2 pairs (§6.1-adjacent). No `stable` field — every v2 pool is
  // constant-product, unlike its Solidly descendants.
  | {
      kind: "uniswap-v2";
      router: Address;
      pool: Address;
      token0: Address;
      token1: Address;
    }
  // Balancer v3 / Beets. `poolId` is the Vault registration id; `asset` is the
  // single token joined with (§6.2).
  | { kind: "balancer-lp"; vault: Address; poolId: Hex; asset: Address }
  // Liquid staking / restaking (§6.4). `venue` selects the pinned entry
  // contract + stake shape from the address-book; `receipt` is the
  // rate-appreciating token; `exit` records how a withdraw is serviced so the
  // UI never promises an instant exit it can't honour (§12 Q2).
  // `asset` is `NATIVE_ASSET_SENTINEL` for native-ETH stakes.
  | {
      kind: "lst-stake";
      venue: string;
      receipt: Address;
      asset: Address;
      exit: "queue" | "dex" | "instant";
    }
  // Router-calldata families (Pendle, Uniswap LP) — no stable on-chain deposit
  // ABI we encode; the protocol's hosted API returns the calldata at execute
  // time. The target models IDENTITY only (§3.4, §6).
  | {
      kind: "router-call";
      protocol: "pendle" | "uniswap-v3" | "uniswap-v4";
      market: Address;
      chainId: number;
      tokenIn: Address;
    }
  // ERC-7540 asynchronous vault (request → fulfil → claim). Tier 4: the kind
  // exists so the union is complete and the validator can reject a
  // non-conforming vault, but NO resolver emits it until the two-phase
  // adapter interface ships (§7) — async pools stay Manual until then.
  | {
      kind: "async-vault";
      vault: Address;
      asset: Address;
      flavor: "7540-deposit" | "7540-redeem" | "7540-both";
    }
  | { kind: "scallop-market"; market: string; coinType: string }
  // Ember Vaults (Sui) — `ember_vaults::gateway::deposit_asset_v2<T,R>`.
  // `vault` = immutable shared Vault<T,R> object id; `coinType` = deposited coin
  // (T, == underlyingTokens[0]); `shareType` = receipt coin (R). Package +
  // ProtocolConfig are mutable → fetched by the mobile adapter, not in the
  // target. Resolved from the Bluefin Ember Vaults API (§3.1: prefer the plain
  // HTTPS endpoint over the SDK).
  | { kind: "ember-vault"; vault: string; coinType: string; shareType: string }
  // NAVI (Sui lending) — `lending_core::incentive_v3::entry_deposit<T>`. No
  // receipt coin: supply is tracked in NAVI's shared `Storage` keyed by numeric
  // `assetId` (+ per-coin `Pool<T>` object). `coinType` == underlyingTokens[0].
  | { kind: "navi-pool"; pool: string; assetId: number; coinType: string }
  // Suilend (Sui lending) — `lending_market::deposit_liquidity_and_mint_ctokens
  // <P,T>`. `lendingMarket` = shared LendingMarket<P> object; `marketType` = the
  // P phantom (`<pkg>::suilend::MAIN_POOL`) — the mobile adapter derives the
  // package from it; `reserveArrayIndex` = the reserve's slot in
  // LendingMarket.reserves[] (u64 arg); `coinType` (T) == underlyingTokens[0].
  // Receipt = `Coin<reserve::CToken<P,T>>`.
  | {
      kind: "suilend-market";
      lendingMarket: string;
      marketType: string;
      reserveArrayIndex: number;
      coinType: string;
    }
  // Sui liquid staking (Haedal / Volo / SpringSui / Aftermath). The user
  // supplies `Coin<SUI>` and receives a liquid-staking receipt coin; the deposit
  // is ORACLE-FREE (no Pyth), unlike Suilend. `venue` selects the mobile
  // adapter's pinned stake shape + shared objects; `lstType` is the receipt
  // coin. These pools are NOT in DeFiLlama — the `SuiLstSource` synthesizes them.
  | { kind: "sui-lst"; venue: string; lstType: string }
  | { kind: "solana-reserve"; program: string; reserve: string; mint: string };

export type DepositTargetKind = DepositTarget["kind"];

/**
 * The EVM subset of `DepositTargetKind`. Every entry MUST have an explicit
 * on-chain validator — `validateTarget`'s `default: return true` passthrough
 * is removed for these (spec §8.1), so a new EVM kind that forgets its
 * validator is rejected rather than silently trusted. Non-EVM kinds keep
 * resolver-internal validation.
 */
export const EVM_TARGET_KINDS = [
  "erc4626",
  "aave-v3",
  "morpho-blue",
  "compound-v3",
  "compound-v2",
  "curve-lp",
  "solidly-lp",
  "uniswap-v2",
  "balancer-lp",
  "lst-stake",
  "router-call",
  "async-vault",
] as const satisfies readonly DepositTargetKind[];

export type EvmTargetKind = (typeof EVM_TARGET_KINDS)[number];

export function isEvmTargetKind(
  kind: DepositTargetKind,
): kind is EvmTargetKind {
  return (EVM_TARGET_KINDS as readonly string[]).includes(kind);
}

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
  /**
   * A read-only client for an EVM chain, or `null` when we cannot reach it.
   *
   * Resolution details that only the chain knows — a Curve pool's `coins[]`
   * arity and index type, a Solidly pool's `stable` flag, a Balancer pool's
   * registration id — are read HERE rather than fetched from the protocol's
   * API. That keeps them out of §11 Layer-6's "untrusted external data"
   * category entirely: chain state cannot be spoofed by a compromised API, and
   * the read happens once at resolve time so the adapter never has to probe
   * per build (§3.3).
   *
   * Optional so existing resolvers and their fixtures are unaffected; a
   * resolver that needs it and doesn't get it fails closed to Manual.
   */
  publicClient?(chainId: number): EvmReadClient | null;
}

/**
 * The narrow slice of viem's `PublicClient` resolvers are allowed to use:
 * reads only. Typed structurally so tests can pass a stub without pulling
 * viem's full client type in.
 */
export interface EvmReadClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getBytecode?(args: { address: Address }): Promise<string | undefined>;
  /**
   * Batched reads. Optional so a stubbed client in a spec need not implement
   * it — callers fall back to sequential `readContract`.
   *
   * Needed by the candidate sources that enumerate a protocol's own on-chain
   * registry: Euler lists ~900 vaults, and asking each one for `asset()` in a
   * separate round trip is not something to do inside a scoring loop.
   */
  multicall?(args: {
    contracts: readonly {
      address: Address;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }[];
    multicallAddress?: Address;
    allowFailure?: boolean;
  }): Promise<readonly { status: "success" | "failure"; result?: unknown }[]>;
}

/**
 * DeFiLlama chain name → EVM chainId.
 *
 * Chain support is **data-driven** — the mapping comes from the `Blockchain`
 * table via `chain-directory.ts`, never a literal in this file. Coverage in
 * this spec scales by execution *family*, so a resolver must reach every EVM
 * chain a family is deployed on; that set is whatever ops has seeded, and
 * adding one is a row plus an rpc-proxy route. Unknown/unloaded → `0` → the
 * resolver fails closed to Manual.
 *
 * Re-exported here so the ~20 existing `from "./types"` imports keep working.
 */
export { resolveEvmChainId } from "./chain-directory";

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
