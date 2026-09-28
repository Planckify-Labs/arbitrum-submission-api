/**
 * Pure helpers shared by the two Circle adapters (`circle-cctp` for USDC,
 * `circle-cctpx` for EURC). No I/O, no Nest, no App Kit import.
 *
 * Spec: docs/bridge-capability-spec.md §2 (superseded note), §5.4, §7.7.
 *
 * Shared HELPERS, never a shared branch: USDC and EURC are two different
 * Circle products (different entry contract, fee currency, approval
 * target and chain set), so each keeps its own adapter and nothing here
 * asks "which token is this?".
 *
 * Every fact below is sourced from Circle primary docs or from the App
 * Kit chain definitions themselves, verified 2026-09-26:
 *   - developers.circle.com/cctp/concepts/supported-chains-and-domains
 *   - developers.circle.com/cctp/concepts/finality-and-block-confirmations
 *   - developers.circle.com/api-reference/cctp/all/get-messages-v2
 *   - docs.arc.io/app-kit/tutorials/bridge/use-forwarding-service
 */

import { buildCaip19, parseCaip2, parseCaip19 } from "../../caip";
import type {
  BridgeFee,
  BridgePhase,
  BridgeStatus,
  BridgeSupportedChain,
  BridgeToken,
  Caip2,
  Caip19,
} from "../../types";

/**
 * The subset of an App Kit `ChainDefinition` these adapters read. Typed
 * locally so the pure helpers (and their tests) never import the SDK.
 */
export interface CircleChainDef {
  /** App Kit identifier, e.g. `"Base"`, `"Arc_Testnet"`, `"Solana"`. */
  chain: string;
  name: string;
  type: "evm" | "solana" | string;
  chainId?: number;
  isTestnet: boolean;
  explorerUrl?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  usdcAddress?: string | null;
  eurcAddress?: string | null;
  cctp?: {
    domain: number;
    contracts?: {
      v2?: {
        /** `split` deployments name `tokenMessenger`; `merged` ones name `contract`. */
        type?: string;
        tokenMessenger?: string;
        contract?: string;
        confirmations?: number;
        fastConfirmations?: number;
      };
    };
    forwarderSupported?: { source: boolean; destination: boolean };
  } | null;
  cctpx?: { serviceAddress: string } | null;
}

/**
 * Solana CAIP-2 references (CAIP-30: the first 32 chars of the genesis
 * hash). Mirrors `services/walletKit/solana/bridge.ts` on mobile.
 */
const SOLANA_REFERENCE_BY_TESTNET: Record<"mainnet" | "testnet", string> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  testnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

/** CAIP-2 for an App Kit chain, or `null` for a type we do not route. */
export function caip2ForCircleChain(def: CircleChainDef): Caip2 | null {
  if (def.type === "evm" && typeof def.chainId === "number") {
    return `eip155:${def.chainId}`;
  }
  if (def.type === "solana") {
    return `solana:${SOLANA_REFERENCE_BY_TESTNET[def.isTestnet ? "testnet" : "mainnet"]}`;
  }
  return null;
}

/** Find the App Kit chain definition behind a CAIP-2 id. */
export function findCircleChain(
  chains: readonly CircleChainDef[],
  caip2: Caip2,
): CircleChainDef | null {
  const parsed = parseCaip2(caip2);
  if (!parsed) return null;
  return chains.find((def) => caip2ForCircleChain(def) === caip2) ?? null;
}

/**
 * Standard-transfer attestation windows per CCTP source domain, in
 * seconds, from Circle's "Finality and block confirmations" table
 * (Standard column). Display metadata only: a domain missing here falls
 * back to a range derived from its confirmation count, so a new Circle
 * domain still quotes.
 */
const STANDARD_ATTESTATION_SECONDS: Record<number, [number, number]> = {
  0: [900, 1140], // Ethereum ~15-19 min
  1: [5, 30], // Avalanche ~8 s
  2: [900, 1140], // OP Mainnet ~15-19 min
  3: [900, 1140], // Arbitrum ~15-19 min
  5: [20, 60], // Solana ~25 s
  6: [900, 1140], // Base ~15-19 min
  7: [5, 30], // Polygon PoS ~8 s
  10: [900, 1140], // Unichain ~15-19 min
  11: [21_600, 115_200], // Linea ~6-32 h
  12: [900, 1140], // Codex ~15-19 min
  13: [5, 30], // Sonic ~8 s
  14: [900, 1140], // World Chain ~15-19 min
  15: [5, 30], // Monad ~5 s
  16: [5, 30], // Sei ~5 s
  18: [5, 30], // XDC ~10 s
  19: [5, 30], // HyperEVM ~5 s
  21: [1_500, 2_100], // Ink ~30 min
  22: [900, 1140], // Plume ~15-19 min
  26: [2, 30], // Arc ~0.5 s
  27: [5, 30], // Stellar ~5 s
  28: [960, 1260], // EDGE ~16-21 min
  29: [2, 30], // Injective
  30: [1_200, 1_800], // Morph ~20-30 min
  31: [5, 30], // Pharos ~7 s
  32: [2, 30], // Cronos
  33: [2, 30], // Plasma
  37: [900, 1140], // X Layer ~15-19 min
};

/**
 * A standard transfer slower than this is not offered through the Circle
 * adapters. Linea's standard attestation is 6-32 HOURS; quoting that as a
 * default route would strand a user's money for a day behind a free fee
 * line. Those sources fall through to the next adapter instead (LI.FI),
 * which can route them through a fast bridge and discloses its own fee.
 */
export const MAX_STANDARD_ATTESTATION_SECONDS = 3_600;

/**
 * Forwarding Service delivery on the destination, added on top of the
 * attestation window. Circle quotes no fixed figure; this is the honest
 * "a little longer" margin rather than a promise.
 */
const FORWARD_DELIVERY_SECONDS: [number, number] = [5, 120];

export function standardDurationRange(
  source: CircleChainDef,
): [number, number] {
  const domain = source.cctp?.domain;
  const attest =
    (domain !== undefined ? STANDARD_ATTESTATION_SECONDS[domain] : undefined) ??
    ((source.cctp?.contracts?.v2?.confirmations ?? 65) > 20
      ? ([900, 1140] as [number, number])
      : ([5, 60] as [number, number]));
  return [
    attest[0] + FORWARD_DELIVERY_SECONDS[0],
    attest[1] + FORWARD_DELIVERY_SECONDS[1],
  ];
}

export function isStandardAttestationAcceptable(
  source: CircleChainDef,
): boolean {
  const domain = source.cctp?.domain;
  const known =
    domain !== undefined ? STANDARD_ATTESTATION_SECONDS[domain] : undefined;
  return known ? known[1] <= MAX_STANDARD_ATTESTATION_SECONDS : true;
}

/**
 * Smallest-unit integer string → the human decimal string App Kit takes
 * (`"1.5"`, never `"1500000"`). Exact: no float ever touches the value.
 */
export function rawToDecimalString(raw: bigint, decimals: number): string {
  if (raw < 0n) throw new RangeError("negative amount");
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

/**
 * The reverse of {@link rawToDecimalString}. Precision beyond `decimals`
 * rounds UP (see below), so a fee is never under-reported.
 */
export function decimalStringToRaw(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new RangeError("not a decimal string");
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    // Round UP: every caller uses this for FEES, and under-reporting a
    // fee the user pays is the one direction that is never acceptable.
    const kept = frac.slice(0, decimals);
    const dropped = frac.slice(decimals);
    const base = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(kept || "0");
    return /[1-9]/.test(dropped) ? base + 1n : base;
  }
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(frac.padEnd(decimals, "0") || "0")
  );
}

export function irisBaseUrl(isTestnet: boolean): string {
  return isTestnet
    ? "https://iris-api-sandbox.circle.com"
    : "https://iris-api.circle.com";
}

/**
 * One message from Iris `GET /v2/messages/{sourceDomainId}`. Only the
 * fields the status mapping reads; everything else is ignored.
 */
export interface IrisMessage {
  status?: string;
  attestation?: string;
  message?: string;
  eventNonce?: string;
  forwardState?: string | null;
  forwardTxHash?: string | null;
  delayReason?: string | null;
}

/**
 * Map an Iris message onto the provider-agnostic status (§7.7, §7.7.1).
 *
 * Forwarded routes only. The Forwarding Service submits the destination
 * mint itself, so "attested" is NOT "done": the transfer completes when
 * `forwardState` reaches `CONFIRMED` (mined) or `COMPLETE` (mined + final)
 * with a delivery hash, exactly the predicate App Kit's own relayer-mint
 * poll uses. `FAILED` is terminal for the forward; burn-and-mint has no
 * partial or refunded outcome (§7.7.1), so the only terminal values here
 * are `completed` and `failed`.
 *
 * `mintStepKey` is the adapter's own key for the destination step
 * (`mint` for USDC, `forward` for EURC), so the card highlights the right
 * row without this helper knowing which product it serves.
 */
export function statusFromIrisMessage(args: {
  message: IrisMessage | undefined;
  sourceTxHash: string;
  burnStepKey: string;
  mintStepKey: string;
  explorerUrlFor?: (hash: string) => string | undefined;
}): BridgeStatus {
  const { message, sourceTxHash, burnStepKey, mintStepKey } = args;
  const base = { sourceTxHash };

  if (!message) {
    // Not indexed yet is the normal state right after submit.
    return {
      ...base,
      outcome: null,
      phase: "pending_source",
      currentStepKey: burnStepKey,
    };
  }

  const forwardState = (message.forwardState ?? "").toUpperCase();
  if (forwardState === "FAILED") {
    return {
      ...base,
      outcome: "failed",
      phase: "pending_destination",
      currentStepKey: mintStepKey,
    };
  }

  const delivered =
    (forwardState === "CONFIRMED" || forwardState === "COMPLETE") &&
    typeof message.forwardTxHash === "string" &&
    message.forwardTxHash.length > 0;
  if (delivered) {
    const hash = message.forwardTxHash as string;
    return {
      ...base,
      outcome: "completed",
      phase: "settled",
      currentStepKey: mintStepKey,
      destinationTxHash: hash,
      explorerUrl: args.explorerUrlFor?.(hash),
    };
  }

  const attested =
    message.status === "complete" &&
    typeof message.attestation === "string" &&
    message.attestation !== "PENDING";
  const phase: BridgePhase = attested
    ? "pending_destination"
    : "pending_attestation";
  return {
    ...base,
    outcome: null,
    phase,
    currentStepKey: attested ? mintStepKey : "attestation",
  };
}

/** Explorer link from an App Kit `explorerUrl` template (`…/tx/{hash}`). */
export function explorerLink(
  def: CircleChainDef | null,
  hash: string,
): string | undefined {
  const template = def?.explorerUrl;
  if (!template || !template.includes("{hash}")) return undefined;
  return template.replace("{hash}", encodeURIComponent(hash));
}

// ── token + fee builders ──────────────────────────────────────────────

/**
 * CAIP-19 for a contract-issued token on an App Kit chain, in the exact
 * shape the wallet kits emit (`erc20:` lowercased for EVM, `token:`
 * verbatim for a case-sensitive Solana mint).
 */
export function tokenCaip19(
  def: CircleChainDef,
  address: string,
): Caip19 | null {
  const chain = caip2ForCircleChain(def);
  if (!chain) return null;
  if (def.type === "evm")
    return buildCaip19(chain, "erc20", address.toLowerCase());
  if (def.type === "solana") return buildCaip19(chain, "token", address);
  return null;
}

/** Does `asset` name this exact contract on this exact chain? */
export function assetIsToken(
  asset: Caip19,
  def: CircleChainDef,
  address: string | null | undefined,
): boolean {
  if (!address) return false;
  const parsed = parseCaip19(asset);
  const chain = caip2ForCircleChain(def);
  if (!parsed || !chain || parsed.chain !== chain) return false;
  if (def.type === "evm") {
    return (
      parsed.assetNamespace === "erc20" &&
      parsed.assetReference.toLowerCase() === address.toLowerCase()
    );
  }
  // Solana mints are base58 and case-SENSITIVE: compare verbatim
  // (`feedback_address_case_per_encoding`).
  return parsed.assetNamespace === "token" && parsed.assetReference === address;
}

export function circleToken(args: {
  def: CircleChainDef;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}): BridgeToken {
  const chain = caip2ForCircleChain(args.def) as Caip2;
  return {
    caip19: tokenCaip19(args.def, args.address) as Caip19,
    chain,
    address: args.address,
    symbol: args.symbol,
    name: args.name,
    decimals: args.decimals,
    isNative: false,
    // Circle-issued, pinned by Circle's own chain definitions.
    verification: "verified",
  };
}

/**
 * The chain's gas token, from App Kit's own chain definition. Its
 * decimals come from there too: Arc's native gas is USDC at EIGHTEEN
 * decimals, while its ERC-20 USDC interface is six, and a shared
 * constant would get one of them wrong.
 */
export function nativeToken(def: CircleChainDef): BridgeToken {
  const chain = caip2ForCircleChain(def) as Caip2;
  const coinType = def.type === "solana" ? "501" : "60";
  return {
    caip19: buildCaip19(chain, "slip44", coinType),
    chain,
    address: "native",
    symbol: def.nativeCurrency.symbol,
    name: def.nativeCurrency.name,
    decimals: def.nativeCurrency.decimals,
    isNative: true,
    verification: "verified",
  };
}

/**
 * Source-chain gas lines (approve, burn). Paid by the sender out of band,
 * never deducted from the output. A line App Kit could not estimate is
 * dropped rather than shown as zero: an absent number is honest, a
 * fabricated "free" is not.
 */
export function sourceGasFees(
  def: CircleChainDef,
  gasFees: ReadonlyArray<{ name: string; fee: string | null }>,
): BridgeFee[] {
  const token = nativeToken(def);
  let total = 0n;
  for (const g of gasFees) {
    if (!g.fee) continue;
    try {
      total += decimalStringToRaw(g.fee, token.decimals);
    } catch {
      // Unparseable estimate: omit rather than guess.
    }
  }
  if (total === 0n) return [];
  return [
    {
      key: "gas_source",
      label: "Network fee on source chain",
      amountRaw: total.toString(),
      token,
      included: false,
    },
  ];
}

export function supportRow(
  def: CircleChainDef,
  provider: string,
): BridgeSupportedChain | null {
  const chain = caip2ForCircleChain(def);
  if (!chain) return null;
  return {
    chain,
    name: def.name,
    providers: [provider],
    nativeSymbol: def.nativeCurrency.symbol,
  };
}

/** Fetch the single Iris message for a burn, or `undefined` if not indexed yet. */
export async function fetchIrisMessage(args: {
  domain: number;
  isTestnet: boolean;
  txHash: string;
  fetchImpl?: typeof fetch;
}): Promise<IrisMessage | undefined> {
  const doFetch = args.fetchImpl ?? fetch;
  const url = `${irisBaseUrl(args.isTestnet)}/v2/messages/${args.domain}?transactionHash=${encodeURIComponent(args.txHash)}`;
  const res = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
  // 404 is "not indexed yet", the normal state right after submit.
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(`iris ${res.status}`);
  }
  const body = (await res.json()) as { messages?: IrisMessage[] };
  return body.messages?.[0];
}
