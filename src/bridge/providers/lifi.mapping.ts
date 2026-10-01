/**
 * LI.FI ⇄ CAIP mapping — pure functions, no Nest, no I/O.
 *
 * Spec: docs/bridge-capability-spec.md §5.2, §6, §7.7.1.
 *
 * Everything in this file is LI.FI's PRIVATE numbering and vocabulary.
 * It lives inside the adapter boundary on purpose: `eip155:8453` → `8453`,
 * `solana:…` → `1151111081099710`, `sui:mainnet` → `9270000000000000`.
 * None of it may leak upward into shared code (§5.2).
 */

import type {
  Estimate,
  ExtendedChain,
  FeeCost,
  GasCost,
  LiFiStep,
  StatusResponse,
  Token,
} from "@lifi/sdk";
import { buildCaip19, isNativeAsset, parseCaip19, parseCaip2 } from "../caip";
import type {
  BridgeFee,
  BridgeMechanism,
  BridgeOutcome,
  BridgePhase,
  BridgeProviderInfo,
  BridgeRouteStep,
  BridgeStatus,
  BridgeToken,
  Caip19,
  Caip2,
} from "../types";

/**
 * LI.FI's EVM native-token sentinel.
 *
 * LI.FI accepts both the all-zero address and this `0xEeee…` alias, and
 * echoes the zero address back in responses. We SEND this one because it
 * is the value the shipped `defi_cross_chain_deposit` path has been using
 * in production against live routes — changing the request sentinel while
 * widening the payload would mix a behavioural change into what is meant
 * to be a pure widening (§9 phase 0).
 */
export const LIFI_EVM_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** LI.FI's Solana native-SOL sentinel (the System Program id). */
export const LIFI_SOLANA_NATIVE = "11111111111111111111111111111111";

/** LI.FI's Sui native coin type. */
export const LIFI_SUI_NATIVE = "0x2::sui::SUI";

/**
 * Non-EVM CAIP-2 ids keyed by LI.FI's internal chain id.
 *
 * EVM needs no table (`eip155:<id>` ↔ `<id>` is mechanical). The three
 * non-EVM chains do, because LI.FI invented integer ids for chains whose
 * real identity is a genesis hash or a network name.
 */
const NON_EVM_CAIP2_BY_LIFI_ID: Record<number, Caip2> = {
  // Solana mainnet-beta — CAIP-2 reference is the truncated genesis hash.
  1151111081099710: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  // Sui mainnet.
  9270000000000000: "sui:mainnet",
  // Bitcoin mainnet (CAIP-2 / bip122). We have no BTC wallet — this entry
  // exists so the support matrix reports it honestly rather than silently
  // dropping a chain LI.FI does reach (§1 non-goals).
  20000000000001: "bip122:000000000019d6689c085ae165831e93",
};

const LIFI_ID_BY_NON_EVM_CAIP2: Record<Caip2, number> = Object.fromEntries(
  Object.entries(NON_EVM_CAIP2_BY_LIFI_ID).map(([id, caip2]) => [
    caip2,
    Number(id),
  ]),
);

/** CAIP-2 → LI.FI chain id. `null` when LI.FI cannot express the chain. */
export function caip2ToLifiChainId(chain: Caip2): number | null {
  const known = LIFI_ID_BY_NON_EVM_CAIP2[chain];
  if (known !== undefined) return known;

  const parsed = parseCaip2(chain);
  if (!parsed) return null;
  if (parsed.namespace !== "eip155") return null;

  const id = Number.parseInt(parsed.reference, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** LI.FI chain id → CAIP-2. */
export function lifiChainIdToCaip2(id: number): Caip2 | null {
  const known = NON_EVM_CAIP2_BY_LIFI_ID[id];
  if (known) return known;
  return Number.isFinite(id) && id > 0 ? `eip155:${id}` : null;
}

/**
 * CAIP-19 → LI.FI token identifier.
 *
 * This is the generic fix for §4.1 and §4.3 at once: a Solana mint and a
 * Sui coin type are now expressible, and "is this the native asset" is a
 * structural property of the CAIP-19 rather than `symbol === "ETH"`.
 */
export function caip19ToLifiToken(asset: Caip19): string | null {
  const parsed = parseCaip19(asset);
  if (!parsed) return null;

  if (isNativeAsset(asset)) {
    switch (parsed.chainNamespace) {
      case "eip155":
        return LIFI_EVM_NATIVE;
      case "solana":
        return LIFI_SOLANA_NATIVE;
      case "sui":
        return LIFI_SUI_NATIVE;
      default:
        return null;
    }
  }

  switch (parsed.chainNamespace) {
    case "eip155":
      return parsed.assetNamespace === "erc20" ? parsed.assetReference : null;
    case "solana":
      return parsed.assetNamespace === "token" ? parsed.assetReference : null;
    case "sui":
      return parsed.assetNamespace === "coin" ? parsed.assetReference : null;
    default:
      return null;
  }
}

/** LI.FI token → CAIP-19, given the CAIP-2 chain it sits on. */
export function lifiTokenToCaip19(chain: Caip2, address: string): Caip19 {
  const parsed = parseCaip2(chain);
  const ns = parsed?.namespace ?? "eip155";

  if (isLifiNativeAddress(ns, address)) {
    switch (ns) {
      case "eip155":
        return buildCaip19(chain, "slip44", "60");
      case "solana":
        return buildCaip19(chain, "slip44", "501");
      case "sui":
        return buildCaip19(chain, "coin", LIFI_SUI_NATIVE);
      default:
        return buildCaip19(chain, "native");
    }
  }

  switch (ns) {
    case "eip155":
      return buildCaip19(chain, "erc20", address);
    case "solana":
      return buildCaip19(chain, "token", address);
    case "sui":
      return buildCaip19(chain, "coin", address);
    default:
      return buildCaip19(chain, "token", address);
  }
}

function isLifiNativeAddress(namespace: string, address: string): boolean {
  if (namespace === "eip155") {
    const lower = address.toLowerCase();
    return (
      lower === LIFI_EVM_NATIVE ||
      lower === "0x0000000000000000000000000000000000000000"
    );
  }
  // Solana base58 and Sui coin types are compared verbatim / case-folded
  // respectively — never blanket-lowercased
  // (`feedback_address_case_per_encoding`).
  if (namespace === "solana") return address === LIFI_SOLANA_NATIVE;
  if (namespace === "sui") {
    return /^0x0*2::sui::SUI$/.test(address);
  }
  return false;
}

/**
 * LI.FI `Token` → `BridgeToken`.
 *
 * `decimals` is carried through verbatim and is the whole point of §6:
 * we used to return `toAmount` with no decimals, so every call site
 * formatted by guesswork. Stellar USDC is 7 decimals while USDC
 * everywhere else is 6, so a shared constant would misprice by 10x.
 */
export function toBridgeToken(chain: Caip2, token: Token): BridgeToken {
  const caip19 = lifiTokenToCaip19(chain, token.address);
  return {
    caip19,
    chain,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    priceUsd: token.priceUSD,
    logoUri: token.logoURI,
    isNative: isNativeAsset(caip19),
    verification: readVerification(token),
  };
}

/**
 * LI.FI's REST payload carries a `verificationStatus` that its published
 * TypeScript types do not yet declare, so we read it defensively and fold
 * it into a closed set. Anything unrecognised becomes `"unknown"` — a raw
 * provider string must never reach the UI (CLAUDE.md user-facing errors).
 */
function readVerification(token: Token): BridgeToken["verification"] {
  const raw = (token as Token & { verificationStatus?: unknown })
    .verificationStatus;
  if (typeof raw === "string") {
    const v = raw.toLowerCase();
    if (v === "verified" || v === "trusted") return "verified";
    if (v === "unverified" || v === "unknown") return "unverified";
  }
  // Fall back to the tag set: LI.FI tags well-known assets.
  const tags = token.tags;
  if (Array.isArray(tags) && tags.length > 0) return "verified";
  return "unknown";
}

/**
 * Bridge tool key → trust model (§7.3).
 *
 * Burn-and-mint, liquidity pool, and intent/filler are DIFFERENT trust
 * models and users are entitled to know which one they are in. The four
 * CCTP keys are the ones the spec enumerates in §2.1.
 */
const BURN_MINT_TOOLS = new Set([
  "celercircle",
  "celercirclefast",
  "mayanmctp",
  "mayanfastmctp",
  "cctp",
  "circle",
]);

const INTENT_TOOLS = new Set([
  "across",
  "relay",
  "eco",
  "nearintents",
  "garden",
  "mayan",
  "mayanswift",
]);

export function classifyMechanism(toolKey: string): BridgeMechanism {
  const key = toolKey.toLowerCase();
  if (BURN_MINT_TOOLS.has(key)) return "burn_mint";
  if (INTENT_TOOLS.has(key)) return "intent_filler";
  return toolKey ? "liquidity_pool" : "unknown";
}

/** Whether a route delivers the canonical issuance rather than a wrapper (§7.1). */
export function receivesNativeIssuance(toolKey: string): boolean {
  return classifyMechanism(toolKey) === "burn_mint";
}

export function toBridgeProviderInfo(step: LiFiStep): BridgeProviderInfo {
  return {
    key: step.tool,
    name: step.toolDetails?.name ?? step.tool,
    logoUri: step.toolDetails?.logoURI,
    mechanism: classifyMechanism(step.tool),
  };
}

/**
 * Fee itemisation (§7.2). Each line is marked deducted-from-output or
 * charged-on-top via `included`, which the old 8-field payload dropped
 * entirely — ignoring it means either double-counting or under-reporting.
 */
export function toBridgeFees(
  estimate: Estimate | undefined,
  fromChain: Caip2,
  toChain?: Caip2,
): BridgeFee[] {
  const fees: BridgeFee[] = [];
  // A same-chain route is a swap: "bridge fee" and "source chain" describe
  // a transfer that is not happening.
  const swap = toChain === fromChain;

  for (const fee of estimate?.feeCosts ?? []) {
    fees.push(relabel(feeCostToBridgeFee(fee), swap));
  }
  for (const gas of estimate?.gasCosts ?? []) {
    const line = gasCostToBridgeFee(gas, fromChain);
    if (line) fees.push(relabel(line, swap));
  }

  return fees;
}

function relabel(fee: BridgeFee, swap: boolean): BridgeFee {
  if (!swap) return fee;
  if (fee.key === "bridge") return { ...fee, label: "Swap fee" };
  if (fee.key === "gas_source") return { ...fee, label: "Network fee" };
  return fee;
}

function feeCostToBridgeFee(fee: FeeCost): BridgeFee {
  const chain = lifiChainIdToCaip2(fee.token.chainId) ?? "eip155:1";
  const name = (fee.name ?? "").toLowerCase();
  const key: BridgeFee["key"] = name.includes("integrator")
    ? "integrator"
    : name.includes("forward")
      ? "forwarding"
      : "bridge";
  return {
    key,
    label: labelForFeeKey(key),
    amountRaw: fee.amount ?? "0",
    token: toBridgeToken(chain, fee.token),
    amountUsd: fee.amountUSD,
    included: fee.included === true,
  };
}

function gasCostToBridgeFee(gas: GasCost, fromChain: Caip2): BridgeFee | null {
  // `SUM` double-counts the individual `APPROVE` / `SEND` lines.
  if (gas.type === "SUM") return null;
  const chain = lifiChainIdToCaip2(gas.token.chainId) ?? fromChain;
  const isDestination = chain !== fromChain;
  const key: BridgeFee["key"] = isDestination ? "gas_destination" : "gas_source";
  return {
    key,
    label: labelForFeeKey(key),
    amountRaw: gas.amount ?? "0",
    token: toBridgeToken(chain, gas.token),
    amountUsd: gas.amountUSD,
    // Gas is paid by the sender out of band, never deducted from output.
    included: false,
  };
}

/** Hand-written labels. No provider prose reaches the card. */
function labelForFeeKey(key: BridgeFee["key"]): string {
  switch (key) {
    case "bridge":
      return "Bridge fee";
    case "integrator":
      return "Service fee";
    case "gas_source":
      return "Network fee on source chain";
    case "gas_destination":
      return "Network fee on destination chain";
    case "forwarding":
      return "Delivery fee";
    case "gas_top_up":
      return "Gas top up";
    default:
      return "Other fee";
  }
}

/**
 * Route breakdown (§7.3) and the shape the progress card walks (§7.7).
 *
 * The approve step is PRESENCE-CHECKED, never assumed: it exists only
 * when LI.FI reports an `approvalAddress` for a non-native EVM source.
 * There is no approve analogue on Solana, Sui, or Stellar (§10.4).
 */
export function toBridgeSteps(
  step: LiFiStep,
  fromChain: Caip2,
  toChain: Caip2,
  needsApproval: boolean,
): BridgeRouteStep[] {
  const steps: BridgeRouteStep[] = [];

  if (needsApproval) {
    steps.push({
      key: "approve",
      kind: "approve",
      label: "Approve the bridge to move your token",
      fromChain,
    });
  }

  const included = step.includedSteps ?? [];
  if (included.length > 0) {
    for (const [index, inc] of included.entries()) {
      // A quote's `includedSteps` are full `Step`s (tokens live under
      // `action`), unlike the flat `IncludedStep` shape the STATUS
      // response uses. Reading them off the top level silently yields
      // undefined.
      const { fromToken, toToken, fromAmount } = inc.action;
      const incFromChain = lifiChainIdToCaip2(fromToken.chainId) ?? fromChain;
      const incToChain = lifiChainIdToCaip2(toToken.chainId) ?? toChain;
      const crossing = incFromChain !== incToChain;
      const incType = (inc.type as string | undefined)?.toLowerCase();
      let kind: BridgeRouteStep["kind"] = crossing ? "burn" : "swap";
      let label = crossing
        ? `Move funds via ${inc.toolDetails?.name ?? inc.tool}`
        : `Swap via ${inc.toolDetails?.name ?? inc.tool}`;

      if (incType === "protocol" || inc.tool === "feeCollection") {
        kind = "protocol";
        label = inc.toolDetails?.name ?? "Integrator Fee";
      } else if (incType === "swap") {
        kind = "swap";
        label = `Swap via ${inc.toolDetails?.name ?? inc.tool}`;
      } else if (incType === "cross") {
        kind = "burn";
        label = `Move funds via ${inc.toolDetails?.name ?? inc.tool}`;
      }

      steps.push({
        key: `${inc.tool}-${index}`,
        kind,
        label,
        fromChain: incFromChain,
        toChain: incToChain,
        fromToken: toBridgeToken(incFromChain, fromToken),
        toToken: toBridgeToken(incToChain, toToken),
        fromAmountRaw: fromAmount,
        toAmountRaw: inc.estimate?.toAmount,
        provider: {
          key: inc.tool,
          name: inc.toolDetails?.name ?? inc.tool,
          logoUri: inc.toolDetails?.logoURI,
          mechanism: classifyMechanism(inc.tool),
        },
      });
    }
  } else {
    const isSwap = fromChain === toChain;
    steps.push({
      key: step.tool,
      kind: isSwap ? "swap" : "burn",
      label: isSwap
        ? `Swap via ${step.toolDetails?.name ?? step.tool}`
        : `Move funds via ${step.toolDetails?.name ?? step.tool}`,
      fromChain,
      toChain,
      provider: toBridgeProviderInfo(step),
    });
  }

  // Every cross-chain route has a settlement wait and a delivery leg. For
  // CCTP that is literally `fetchAttestation` → `mint`; for a liquidity or
  // intent bridge it is the filler's destination transaction. Modelling
  // both the same way is what keeps the progress card provider-agnostic.
  // Same-chain swaps have no cross-chain settlement wait.
  if (fromChain !== toChain) {
    steps.push({
      key: "attestation",
      kind: "attestation",
      label: "Wait for the transfer to be confirmed",
      fromChain,
      toChain,
    });
    steps.push({
      key: "mint",
      kind: "mint",
      label: "Deliver funds on the destination chain",
      toChain,
    });
  }

  return steps;
}

/**
 * LI.FI status/substatus → the four-value terminal enum (§7.7.1).
 *
 * `DONE` has THREE outcomes and two of them are not what the user asked
 * for. Treating `DONE` as success renders a "completed" card to a user
 * holding a token they never asked for, so the mapping is explicit.
 */
export function toBridgeStatus(
  res: StatusResponse,
  fallback: { fromChain: Caip2; toChain: Caip2; sourceTxHash: string },
): BridgeStatus {
  const status = res.status;
  const substatus = res.substatus;

  const sending = (res as { sending?: { txHash?: string } }).sending;
  const receiving = (res as { receiving?: { txHash?: string } }).receiving;
  const explorerUrl = (res as { lifiExplorerLink?: string }).lifiExplorerLink;

  const sourceTxHash = sending?.txHash ?? fallback.sourceTxHash;
  const destinationTxHash = receiving?.txHash;

  let outcome: BridgeOutcome | null = null;
  let phase: BridgePhase = "pending_source";

  if (status === "DONE") {
    phase = "settled";
    outcome =
      substatus === "PARTIAL"
        ? "partial"
        : substatus === "REFUNDED"
          ? "refunded"
          : "completed";
  } else if (status === "FAILED") {
    phase = "settled";
    // A refund that has already landed is an OUTCOME, not an error — but
    // `REFUND_IN_PROGRESS` is still in flight, so it stays non-terminal.
    outcome = substatus === "REFUND_IN_PROGRESS" ? null : "failed";
    if (substatus === "REFUND_IN_PROGRESS") phase = "pending_destination";
  } else if (status === "PENDING") {
    phase =
      substatus === "WAIT_SOURCE_CONFIRMATIONS"
        ? "pending_source"
        : substatus === "WAIT_DESTINATION_TRANSACTION"
          ? "pending_attestation"
          : "pending_destination";
  } else {
    // NOT_FOUND / INVALID: the source tx may simply not be indexed yet.
    phase = "pending_source";
  }

  const receivedToken = toReceivedToken(res, fallback.toChain);

  return {
    outcome,
    phase,
    currentStepKey: phaseToStepKey(phase),
    sourceTxHash,
    destinationTxHash,
    ...(receivedToken ? { receivedToken } : {}),
    ...(receivedToken
      ? {
          receivedAmountRaw: (
            res as { receiving?: { amount?: string } }
          ).receiving?.amount,
        }
      : {}),
    ...(outcome === "refunded" ? { refundChain: fallback.fromChain } : {}),
    ...(explorerUrl ? { explorerUrl } : {}),
  };
}

/**
 * The token the user ACTUALLY received. On a `PARTIAL` this differs from
 * what they asked for, and naming it is the whole reason `partial` is a
 * first-class outcome rather than a success (§7.7.1).
 */
function toReceivedToken(
  res: StatusResponse,
  toChain: Caip2,
): BridgeToken | undefined {
  const receiving = (res as { receiving?: { token?: Token; chainId?: number } })
    .receiving;
  if (!receiving?.token) return undefined;
  const chain = receiving.chainId
    ? (lifiChainIdToCaip2(receiving.chainId) ?? toChain)
    : toChain;
  return toBridgeToken(chain, receiving.token);
}

function phaseToStepKey(phase: BridgePhase): string {
  switch (phase) {
    case "pending_source":
      return "burn";
    case "pending_attestation":
      return "attestation";
    case "pending_destination":
      return "mint";
    default:
      return "mint";
  }
}

/**
 * Slippage policy (§8.4) — a FIXED server-side default per route class,
 * disclosed on the card, deliberately NOT user-adjustable and NOT
 * model-supplied. A safety-critical number must not be under LLM control.
 *
 * Stablecoin-to-stablecoin routes (which is what CCTP is) get a tight
 * band; anything involving a volatile asset gets a wider one.
 */
const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDC.E",
  "USDT",
  "USDT0",
  "DAI",
  "USDS",
  "FDUSD",
  "PYUSD",
  "EURC",
  "USDE",
]);

export const SLIPPAGE_BPS_STABLE = 30;
export const SLIPPAGE_BPS_VOLATILE = 300;

export function slippageBpsFor(
  fromSymbol: string | undefined,
  toSymbol: string | undefined,
): number {
  const from = (fromSymbol ?? "").toUpperCase();
  const to = (toSymbol ?? "").toUpperCase();
  return STABLE_SYMBOLS.has(from) && STABLE_SYMBOLS.has(to)
    ? SLIPPAGE_BPS_STABLE
    : SLIPPAGE_BPS_VOLATILE;
}

/** LI.FI chain list → the queried support matrix rows (§5.3). */
export function toSupportedChain(chain: ExtendedChain): {
  chain: Caip2;
  name: string;
  logoUri?: string;
  nativeSymbol?: string;
} | null {
  const caip2 = lifiChainIdToCaip2(chain.id);
  if (!caip2) return null;
  return {
    chain: caip2,
    name: chain.name,
    logoUri: chain.logoURI,
    nativeSymbol: chain.nativeToken?.symbol,
  };
}
