/**
 * Zerion's chain vocabulary and per-capability coverage.
 *
 * Verified 2026-09-04 against the primary source
 * (https://developers.zerion.io/supported-blockchains). Zerion is NOT
 * EVM-only: Solana is supported for tokens + transactions, with DeFi and
 * NFT marked "coming soon" there. Sui and Stellar are not supported at all.
 *
 * Support is tracked per (chain, capability) pair rather than per namespace
 * so that shipping Solana DeFi upstream is a single flag flip here, with no
 * plumbing changes anywhere else.
 */

/** What a caller wants to read. Mirrors the columns of the coverage table. */
export type ZerionCapability = "tokens" | "transactions" | "defi" | "nft";

export interface ZerionChain {
  /** Zerion's own chain id string, as it appears in `filter[chain_ids]`. */
  readonly zerionId: string;
  /** CAIP namespace, so callers never have to infer it from the chainId. */
  readonly namespace: "eip155" | "solana";
  /**
   * Our numeric chain id. Non-EVM chains have no numeric id in this system,
   * so they carry `null` and are addressed by namespace instead.
   */
  readonly chainId: number | null;
  readonly capabilities: readonly ZerionCapability[];
}

const EVM_FULL: readonly ZerionCapability[] = [
  "tokens",
  "transactions",
  "defi",
  "nft",
];

/** Solana: tokens + transactions today, DeFi/NFT "coming soon" upstream. */
const SOLANA_CAPS: readonly ZerionCapability[] = ["tokens", "transactions"];

/**
 * The chains we actually care about, not Zerion's full ~37-chain list. Adding
 * a chain here is the only step needed to extend coverage, provided the chain
 * also exists in our own Blockchain registry.
 */
export const ZERION_CHAINS: readonly ZerionChain[] = [
  { zerionId: "ethereum", namespace: "eip155", chainId: 1, capabilities: EVM_FULL },
  { zerionId: "optimism", namespace: "eip155", chainId: 10, capabilities: EVM_FULL },
  { zerionId: "binance-smart-chain", namespace: "eip155", chainId: 56, capabilities: EVM_FULL },
  { zerionId: "polygon", namespace: "eip155", chainId: 137, capabilities: EVM_FULL },
  { zerionId: "base", namespace: "eip155", chainId: 8453, capabilities: EVM_FULL },
  { zerionId: "arbitrum", namespace: "eip155", chainId: 42161, capabilities: EVM_FULL },
  { zerionId: "avalanche", namespace: "eip155", chainId: 43114, capabilities: EVM_FULL },
  { zerionId: "solana", namespace: "solana", chainId: null, capabilities: SOLANA_CAPS },
];

const BY_ZERION_ID = new Map(ZERION_CHAINS.map((c) => [c.zerionId, c]));
const BY_CHAIN_ID = new Map(
  ZERION_CHAINS.filter((c) => c.chainId !== null).map((c) => [
    c.chainId as number,
    c,
  ]),
);

/** Zerion's chain id string -> our chain. `undefined` when unsupported. */
export function chainFromZerionId(zerionId: string): ZerionChain | undefined {
  return BY_ZERION_ID.get(zerionId);
}

/** Our numeric chain id -> Zerion's chain. `undefined` when unsupported. */
export function chainFromChainId(chainId: number): ZerionChain | undefined {
  return BY_CHAIN_ID.get(chainId);
}

/**
 * Back-compat shim for the original `CHAIN_ID_BY_ZERION_ID` record that lived
 * in `strategies.service.ts`. EVM-only by construction, since the consumers
 * of that map key positions by numeric chain id.
 */
export const CHAIN_ID_BY_ZERION_ID: Record<string, number> = Object.fromEntries(
  ZERION_CHAINS.filter((c) => c.chainId !== null).map((c) => [
    c.zerionId,
    c.chainId as number,
  ]),
);

export function isSupported(
  chain: ZerionChain | undefined,
  capability: ZerionCapability,
): boolean {
  return chain ? chain.capabilities.includes(capability) : false;
}

/**
 * A chain selector as it arrives from a client: either our numeric chain id
 * (EVM) or a bare namespace / Zerion id string. Non-EVM chains have no numeric
 * id, so `"solana"` is the only way to ask for them.
 */
export type ZerionChainSelector = number | string;

function chainFromSelector(sel: ZerionChainSelector): ZerionChain | undefined {
  if (typeof sel === "number") return chainFromChainId(sel);
  const trimmed = sel.trim();
  if (trimmed === "") return undefined;
  // A numeric string is still a numeric chain id ("8453" out of a CSV param).
  if (/^\d+$/.test(trimmed)) return chainFromChainId(Number(trimmed));
  const lowered = trimmed.toLowerCase();
  return (
    BY_ZERION_ID.get(lowered) ??
    ZERION_CHAINS.find((c) => c.namespace === lowered && c.chainId === null)
  );
}

/**
 * Translate a caller's requested chains into the Zerion ids that actually
 * support `capability`. Unknown selectors and unsupported (chain, capability)
 * pairs are dropped silently — the caller then short-circuits to an empty
 * result rather than spending a request that could only come back empty.
 *
 * An empty/absent selector list means "every chain we support for this
 * capability", which is what the portfolio screens want by default.
 */
export function resolveZerionChainIds(
  chains: readonly ZerionChainSelector[] | undefined,
  capability: ZerionCapability,
): string[] {
  if (!chains || chains.length === 0) {
    return ZERION_CHAINS.filter((c) => isSupported(c, capability)).map(
      (c) => c.zerionId,
    );
  }
  const out: string[] = [];
  for (const sel of chains) {
    const chain = chainFromSelector(sel);
    if (isSupported(chain, capability)) {
      const { zerionId } = chain as ZerionChain;
      if (!out.includes(zerionId)) out.push(zerionId);
    }
  }
  return out;
}
