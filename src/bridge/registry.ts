/**
 * `BridgeRouteAdapter` registry.
 *
 * Spec: docs/bridge-capability-spec.md §5.2.
 *
 * Mirrors `services/defi/registry.ts` in the mobile repo exactly:
 * register / get / list, and NO central switch. `supports()` is the whole
 * seam — adding Bitcoin, or a non-LI.FI provider (a direct CCTP adapter, a
 * Stellar bridge when one exists), is REGISTERING AN ADAPTER. No enum
 * edit, no branch in shared code.
 *
 * The CAIP-2 ↔ provider-chain-id mapping (`eip155:8453` → `8453`,
 * `solana:…` → `1151111081099710`, `sui:mainnet` → `9270000000000000`)
 * lives INSIDE each adapter. That table is the provider's private
 * numbering and must never leak upward.
 */

import type {
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeRef,
  BridgeStatus,
  BridgeSupportedChain,
  BridgeToken,
  Caip19,
  Caip2,
  GasTopUpRequest,
} from "./types";

export interface BridgeRouteAdapter {
  /** Stable registry key, e.g. `"lifi"`, `"cctp"`. */
  key: string;

  /** Can this adapter move value from `from` to `to` at all? */
  supports(from: Caip2, to: Caip2): boolean;

  /**
   * Narrower check for a specific asset pair. Optional: an adapter that
   * routes arbitrary tokens (LI.FI) can leave it undefined and let
   * `supports()` decide. A single-asset adapter (CCTP is USDC-only)
   * implements it so `USDC → Stellar` resolves while `ETH → Stellar`
   * correctly reports a capability boundary rather than a failure (§7.6).
   */
  supportsAsset?(from: Caip19, to: Caip19): boolean;

  /** Provider's private chain id. `null` when the chain is unknown to it. */
  toProviderChainId(c: Caip2): string | number | null;

  /** Provider's private asset identifier. `null` when inexpressible. */
  toProviderAsset(a: Caip19): string | null;

  quote(req: BridgeQuoteRequest): Promise<BridgeQuote>;

  status(ref: BridgeRef): Promise<BridgeStatus>;

  /** Chains this adapter currently reaches, for the queried matrix (§5.3). */
  listSupportedChains(): Promise<BridgeSupportedChain[]>;

  /** Bridge tool keys the adapter aggregates. `[]` for single-mechanism adapters. */
  listTools(): Promise<string[]>;

  /**
   * Resolve a CAIP-19 to full token metadata (symbol, DECIMALS, price).
   * Decimals must come from here, never a shared constant — Stellar USDC
   * is 7 decimals and every other CCTP chain is 6 (§5.4.1, §6).
   */
  resolveToken(asset: Caip19): Promise<BridgeToken | null>;

  // ── optional capabilities, presence-checked (space docking) ─────────
  /**
   * Route a small slice into the destination's gas token (§7.5, §5.2).
   * An adapter that cannot do this simply omits the method; callers
   * presence-check rather than branching. An adapter whose routes carry
   * no strand risk at all (Circle's Forwarding Service pays the
   * destination leg, §7.5.1) also omits it, which is the correct signal.
   */
  gasTopUp?(req: GasTopUpRequest): Promise<BridgeQuote>;
}

const adapters = new Map<string, BridgeRouteAdapter>();

export function registerBridgeAdapter(a: BridgeRouteAdapter): void {
  adapters.set(a.key, a);
}

export function getBridgeAdapter(key: string): BridgeRouteAdapter | null {
  return adapters.get(key) ?? null;
}

export function listBridgeAdapters(): BridgeRouteAdapter[] {
  return [...adapters.values()];
}

/** Test-only: drop every registration so suites start from a clean slate. */
export function resetBridgeAdapters(): void {
  adapters.clear();
}

/**
 * Every adapter that can serve this exact route, most-specific first.
 *
 * An adapter that declares `supportsAsset` is answering a narrower
 * question, so it sorts ahead of one that only answered `supports`. In
 * practice the two current adapters do not overlap at all — the `cctp`
 * adapter is deliberately scoped to Stellar-only (§5.4 / §10.5) precisely
 * so there is nothing to arbitrate — but the ordering keeps a future
 * third adapter from silently losing to the generalist.
 */
export function resolveBridgeAdapters(
  from: Caip2,
  to: Caip2,
  fromAsset?: Caip19,
  toAsset?: Caip19,
): BridgeRouteAdapter[] {
  const eligible = listBridgeAdapters().filter((a) => {
    if (!a.supports(from, to)) return false;
    if (a.supportsAsset && fromAsset && toAsset) {
      return a.supportsAsset(fromAsset, toAsset);
    }
    return true;
  });
  return eligible.sort((a, b) => {
    const aSpecific = a.supportsAsset ? 1 : 0;
    const bSpecific = b.supportsAsset ? 1 : 0;
    return bSpecific - aSpecific;
  });
}
