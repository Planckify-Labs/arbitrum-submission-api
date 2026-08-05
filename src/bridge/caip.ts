/**
 * CAIP-2 / CAIP-19 parsing and construction.
 *
 * Spec: docs/bridge-capability-spec.md §5.1.
 *
 * Chain identity is CAIP-2 and asset identity CAIP-19 end to end: agent
 * tool schema → API DTO → executor. This is what removes the
 * `^0x[a-fA-F0-9]{40}$` blocker (§4.1) GENERICALLY, rather than bolting a
 * Solana special-case onto an EVM-shaped DTO.
 *
 * Nothing here knows about any provider's private numbering. That mapping
 * lives inside each `BridgeRouteAdapter` (§5.2) and must never leak up.
 */

import type { Caip19, Caip2 } from "./types";

export interface ParsedCaip2 {
  namespace: string;
  reference: string;
}

export interface ParsedCaip19 {
  chain: Caip2;
  chainNamespace: string;
  chainReference: string;
  /** e.g. `erc20`, `slip44`, `token`, `coin`, `asset`, `native`. */
  assetNamespace: string;
  /** Empty string for parameterless asset namespaces such as `native`. */
  assetReference: string;
}

// CAIP-2: `namespace:reference`. Namespace 3-8 lowercase alphanumeric,
// reference up to 32 chars of `[-_a-zA-Z0-9]`.
const CAIP2_RE = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})$/;

// CAIP-19 asset type: `<caip2>/<assetNamespace>:<assetReference>`.
// The asset reference is deliberately permissive because it must hold a
// Sui coin type (`0x2::sui::SUI`) and a Stellar `CODE:ISSUER` pair, neither
// of which fits the EVM-shaped character set.
const CAIP19_RE = /^([-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32})\/([-a-z0-9]{3,8})(?::(.+))?$/;

export function parseCaip2(value: string): ParsedCaip2 | null {
  const m = CAIP2_RE.exec(value.trim());
  if (!m) return null;
  return { namespace: m[1], reference: m[2] };
}

export function isCaip2(value: string): boolean {
  return parseCaip2(value) !== null;
}

export function parseCaip19(value: string): ParsedCaip19 | null {
  const m = CAIP19_RE.exec(value.trim());
  if (!m) return null;
  const chain = parseCaip2(m[1]);
  if (!chain) return null;
  return {
    chain: m[1],
    chainNamespace: chain.namespace,
    chainReference: chain.reference,
    assetNamespace: m[2],
    assetReference: m[3] ?? "",
  };
}

export function isCaip19(value: string): boolean {
  return parseCaip19(value) !== null;
}

export function buildCaip2(namespace: string, reference: string | number): Caip2 {
  return `${namespace}:${reference}`;
}

export function buildCaip19(
  chain: Caip2,
  assetNamespace: string,
  assetReference?: string,
): Caip19 {
  return assetReference
    ? `${chain}/${assetNamespace}:${assetReference}`
    : `${chain}/${assetNamespace}`;
}

/**
 * Asset namespaces that denote a chain's own gas/native token rather than
 * a contract-issued asset. `slip44` is the CAIP-19 canonical form
 * (`eip155:1/slip44:60`); `native` is Stellar's (`stellar:pubnet/native`).
 *
 * This is the generic replacement for the old `fromAssetSymbol === "ETH"`
 * check (§4.3) — a string comparison that silently failed for SOL, SUI,
 * XLM, POL, BNB, and every other native asset.
 */
const NATIVE_ASSET_NAMESPACES = new Set(["slip44", "native"]);

export function isNativeAsset(asset: Caip19): boolean {
  const parsed = parseCaip19(asset);
  if (!parsed) return false;
  if (NATIVE_ASSET_NAMESPACES.has(parsed.assetNamespace)) return true;
  // Sui models its gas token as an ordinary coin type, so the namespace
  // alone cannot tell us. Compare against the canonical SUI coin type.
  return (
    parsed.chainNamespace === "sui" &&
    parsed.assetNamespace === "coin" &&
    /^0x0*2::sui::SUI$/.test(parsed.assetReference)
  );
}

/** The CAIP-2 chain an asset id belongs to, or `null` when unparseable. */
export function chainOfAsset(asset: Caip19): Caip2 | null {
  return parseCaip19(asset)?.chain ?? null;
}

/**
 * Two CAIP ids refer to the same thing.
 *
 * Case folding is PER-ENCODING, never blanket (`feedback_address_case_per_encoding`):
 * EVM hex addresses and Sui object/coin ids are case-insensitive, while
 * Solana base58 and Stellar strkeys are case-SENSITIVE and must compare
 * verbatim. Lowercasing a Solana mint produces a different, valid-looking
 * key that points at nothing.
 */
const CASE_INSENSITIVE_CHAIN_NAMESPACES = new Set(["eip155", "sui"]);

export function assetEquals(a: Caip19, b: Caip19): boolean {
  const pa = parseCaip19(a);
  const pb = parseCaip19(b);
  if (!pa || !pb) return a === b;
  if (pa.chain !== pb.chain) return false;
  if (pa.assetNamespace !== pb.assetNamespace) return false;
  if (CASE_INSENSITIVE_CHAIN_NAMESPACES.has(pa.chainNamespace)) {
    return pa.assetReference.toLowerCase() === pb.assetReference.toLowerCase();
  }
  return pa.assetReference === pb.assetReference;
}
