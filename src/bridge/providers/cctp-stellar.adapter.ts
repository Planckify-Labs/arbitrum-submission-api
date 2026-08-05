/**
 * `cctp` — Circle CCTP, scoped to routes touching STELLAR ONLY.
 *
 * Spec: docs/bridge-capability-spec.md §5.4, §5.4.1, §10.5, §10.6.
 *
 * ## Why this adapter exists at all
 *
 * Stellar is absent from LI.FI entirely (§3.2), and we ship Stellar. CCTP
 * reaches it directly as domain 27. That is precisely the case the
 * provider registry exists to absorb: a second adapter covers what the
 * first cannot, and no shared code learns the difference.
 *
 * ## Why it is Stellar-only and not a general CCTP provider
 *
 * Decision §10.5. LI.FI already aggregates CCTP through four tool keys
 * and picks it when it is the best USDC route (§2.1), so an EVM-capable
 * `cctp` adapter would add an arbitration problem without adding a single
 * new capability. Scoping to Stellar makes `supports()` deterministic,
 * removes the "optimise for cost or time?" question entirely, and
 * confines this phase's risk to one chain.
 *
 * ## Why the SDK is not used
 *
 * Circle ships Bridge Kit, but its self-custody adapters cover EVM and
 * Solana only; its any-chain claim is scoped to Circle Wallets, which is
 * custodial and therefore not an option for us. The one chain we need
 * CCTP for is the one Bridge Kit cannot serve non-custodially, so this is
 * raw contract calls.
 *
 * ## Direction
 *
 * EVM → Stellar is implemented: the burn is a `depositForBurnWithHook`
 * call on `TokenMessengerV2`, whose ABI is verified against Circle
 * primary source, and the destination mint is atomic and non-custodial
 * inside `CctpForwarder` (so risk concentrates in constructing the SOURCE
 * burn, which `stellar-burn-params.ts` makes unconstructible-if-wrong).
 *
 * Stellar → EVM is deliberately NOT implemented. It needs a Soroban burn
 * whose argument layout we have not verified from primary source, and
 * guessing it is exactly the failure mode §5.4.1 warns about. `supports()`
 * reports false for that direction, so it renders the plain "no route"
 * capability boundary (§7.6) rather than a broken path.
 */

import { Injectable, Logger } from "@nestjs/common";
import { encodeFunctionData } from "viem";
import { DefiError } from "../../strategies/errors/defi-error";
import { buildCaip19, parseCaip19, parseCaip2 } from "../caip";
import type { BridgeRouteAdapter } from "../registry";
import type {
  BridgeExecutionPayload,
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeRef,
  BridgeStatus,
  BridgeSupportedChain,
  BridgeToken,
  Caip19,
  Caip2,
} from "../types";
import {
  buildStellarBurnParams,
  CctpParamError,
  EVM_USDC_DECIMALS,
  isStellarCctpEnabled,
  sourceUsdcToStellarUnits,
  STELLAR_CCTP_CONTRACTS,
  STELLAR_USDC_DECIMALS,
  type StellarCctpNetwork,
} from "./cctp/stellar-burn-params";
import { randomUUID } from "crypto";

/**
 * `TokenMessengerV2`, verified against Circle's EVM contract-address
 * reference. Circle deploys it at the same address on every V2 EVM chain.
 */
const TOKEN_MESSENGER_V2 =
  "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const;

const DEPOSIT_FOR_BURN_WITH_HOOK_ABI = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/**
 * Source chains we can burn from, with their Circle domain and canonical
 * USDC. Pinned rather than discovered because a wrong USDC address here
 * burns the wrong token.
 *
 * This table is intentionally narrow: it is the set of EVM chains this
 * app already ships. Adding one is a row here, never a branch.
 */
const EVM_SOURCES: Record<
  number,
  { domain: number; usdc: `0x${string}`; name: string }
> = {
  1: {
    domain: 0,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    name: "Ethereum",
  },
  10: {
    domain: 2,
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    name: "OP Mainnet",
  },
  137: {
    domain: 7,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    name: "Polygon PoS",
  },
  8453: {
    domain: 6,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "Base",
  },
  42161: {
    domain: 3,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    name: "Arbitrum",
  },
  43114: {
    domain: 1,
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    name: "Avalanche",
  },
};

/**
 * Stellar USDC, as a classic asset. Stellar assets are `CODE:ISSUER`, and
 * the issuer strkey is CASE-SENSITIVE — never fold it
 * (`feedback_address_case_per_encoding`).
 */
const STELLAR_USDC: Record<StellarCctpNetwork, string> = {
  pubnet: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  testnet: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

/**
 * Standard transfer window (§2.3). Stellar has NO Fast Transfer, so there
 * is no faster tier to offer and the range is quoted honestly rather than
 * shown as a bare spinner (§7.7).
 */
const STANDARD_DURATION_RANGE_SECONDS: [number, number] = [900, 1140];

/** Standard transfers carry no protocol fee; only Fast Transfer does. */
const STANDARD_MAX_FEE_RAW = 0n;

@Injectable()
export class CctpStellarAdapter implements BridgeRouteAdapter {
  readonly key = "cctp";

  private readonly logger = new Logger(CctpStellarAdapter.name);

  // ── capability seam ───────────────────────────────────────────────────

  supports(from: Caip2, to: Caip2): boolean {
    // Destination must be Stellar, and source must be an EVM chain we can
    // burn from. Stellar-as-source is a Soroban burn we have not verified
    // (see the file header) and is reported as unsupported on purpose.
    const network = this.stellarNetworkOf(to);
    if (!network) return false;
    if (!isStellarCctpEnabled(network)) return false;
    return this.evmSourceOf(from) !== null;
  }

  /**
   * CCTP is burn-and-mint: it requires the token ISSUER to hold mint
   * authority on the destination. There is no "extend CCTP to more
   * tokens" path — that is a category error. So this is USDC only, and an
   * ETH-to-Stellar request correctly falls through to the no-route state
   * rather than failing mid-flight.
   */
  supportsAsset(from: Caip19, to: Caip19): boolean {
    return this.isUsdc(from) && this.isUsdc(to);
  }

  private stellarNetworkOf(chain: Caip2): StellarCctpNetwork | null {
    const parsed = parseCaip2(chain);
    if (parsed?.namespace !== "stellar") return null;
    // CAIP-28 references are `pubnet` / `testnet`, NOT `mainnet`.
    if (parsed.reference === "pubnet") return "pubnet";
    if (parsed.reference === "testnet") return "testnet";
    return null;
  }

  private evmSourceOf(chain: Caip2): (typeof EVM_SOURCES)[number] | null {
    const parsed = parseCaip2(chain);
    if (parsed?.namespace !== "eip155") return null;
    const id = Number.parseInt(parsed.reference, 10);
    return EVM_SOURCES[id] ?? null;
  }

  private isUsdc(asset: Caip19): boolean {
    const parsed = parseCaip19(asset);
    if (!parsed) return false;

    if (parsed.chainNamespace === "eip155") {
      const source = this.evmSourceOf(parsed.chain);
      if (!source) return false;
      // EVM hex addresses fold case; compare lowercased.
      return parsed.assetReference.toLowerCase() === source.usdc.toLowerCase();
    }

    if (parsed.chainNamespace === "stellar") {
      const network = this.stellarNetworkOf(parsed.chain);
      if (!network) return false;
      // Stellar strkeys are case-SENSITIVE; compare verbatim. The CAIP-19
      // reference carries the hyphen form (see `stellarUsdcToken`).
      return (
        parsed.assetReference === STELLAR_USDC[network].replace(":", "-")
      );
    }

    return false;
  }

  toProviderChainId(c: Caip2): string | number | null {
    const stellar = this.stellarNetworkOf(c);
    if (stellar) return 27;
    return this.evmSourceOf(c)?.domain ?? null;
  }

  toProviderAsset(a: Caip19): string | null {
    return this.isUsdc(a) ? (parseCaip19(a)?.assetReference ?? null) : null;
  }

  // ── quote ─────────────────────────────────────────────────────────────

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
    const network = this.stellarNetworkOf(req.toChain);
    const source = this.evmSourceOf(req.fromChain);
    if (!network || !source) {
      throw new DefiError("unsupported_chain", "cctp serves EVM → Stellar only");
    }
    if (!isStellarCctpEnabled(network)) {
      // Mainnet stays hard-blocked until the mandatory testnet dry-run
      // signs off the hook encoding (§9 phase 4, §10.6).
      throw new DefiError(
        "unsupported_chain",
        "cctp stellar mainnet not enabled pending testnet dry-run",
      );
    }
    if (!this.supportsAsset(req.fromAsset, req.toAsset)) {
      throw new DefiError("unsupported_asset", "cctp bridges USDC only");
    }

    let amountRaw: bigint;
    try {
      amountRaw = BigInt(req.amountRaw);
    } catch {
      throw new DefiError("unsupported_asset", "invalid amount");
    }

    let params: ReturnType<typeof buildStellarBurnParams>;
    try {
      params = buildStellarBurnParams({
        network,
        amountRaw,
        burnToken: source.usdc,
        recipientStrkey: req.toAddress,
        maxFeeRaw: STANDARD_MAX_FEE_RAW,
      });
    } catch (error: unknown) {
      if (error instanceof CctpParamError) {
        this.logger.warn(`[quote] burn params rejected: ${error.message}`);
        throw new DefiError("unsupported_asset", error.message);
      }
      throw error;
    }

    const fromToken = this.evmUsdcToken(req.fromChain, source.usdc);
    const toToken = this.stellarUsdcToken(req.toChain, network);

    // Burn-and-mint is 1:1 by construction — there is no slippage, no
    // liquidity pool, and no price impact. The only transformation is the
    // 6→7 decimal rescale, which comes from the token metadata rather than
    // a shared constant (§6).
    const toAmountRaw = sourceUsdcToStellarUnits(amountRaw).toString();

    const issuedAt = new Date();
    return {
      quoteId: randomUUID(),
      provider: this.key,
      from: {
        chain: req.fromChain,
        chainName: source.name,
        token: fromToken,
        address: req.fromAddress,
        amountRaw: req.amountRaw,
      },
      to: {
        chain: req.toChain,
        chainName: network === "pubnet" ? "Stellar" : "Stellar Testnet",
        token: toToken,
        address: req.toAddress,
        amountRaw: toAmountRaw,
      },
      // Exact by construction: nothing can be lost in transit.
      toAmountMinRaw: toAmountRaw,
      slippageBps: 0,
      fees: [
        {
          key: "bridge",
          label: "Bridge fee",
          amountRaw: "0",
          token: fromToken,
          included: true,
        },
      ],
      // The whole user-visible point of CCTP: real, issuer-minted USDC on
      // Stellar rather than a wrapper (§7.1).
      receivesNativeAsset: true,
      durationSeconds: STANDARD_DURATION_RANGE_SECONDS[1],
      durationRangeSeconds: STANDARD_DURATION_RANGE_SECONDS,
      bridge: {
        key: "cctp",
        name: "Circle CCTP",
        mechanism: "burn_mint",
      },
      steps: [
        {
          key: "approve",
          kind: "approve",
          label: "Approve Circle to move your USDC",
          fromChain: req.fromChain,
        },
        {
          key: "burn",
          kind: "burn",
          label: "Burn USDC on the source chain",
          fromChain: req.fromChain,
          toChain: req.toChain,
        },
        {
          key: "attestation",
          kind: "attestation",
          // Step 3 is where the ~15 to 19 minutes of a Standard transfer
          // goes. Users will stare at it, so it gets honest copy (§7.7).
          label: "Wait for Circle to confirm the burn",
          fromChain: req.fromChain,
          toChain: req.toChain,
        },
        {
          key: "mint",
          kind: "mint",
          label: "Mint USDC on Stellar",
          toChain: req.toChain,
        },
      ],
      execution: this.toBurnTransaction(req.fromChain, source.usdc, params),
      issuedAt: issuedAt.toISOString(),
      // CCTP quotes do not decay the way a liquidity route does, but the
      // freshness contract is shared so the card behaves identically.
      expiresAt: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    };
  }

  private toBurnTransaction(
    fromChain: Caip2,
    usdc: `0x${string}`,
    params: ReturnType<typeof buildStellarBurnParams>,
  ): BridgeExecutionPayload {
    const data = encodeFunctionData({
      abi: DEPOSIT_FOR_BURN_WITH_HOOK_ABI,
      functionName: "depositForBurnWithHook",
      args: [
        params.amountRaw,
        params.destinationDomain,
        params.mintRecipient,
        params.burnToken,
        params.destinationCaller,
        params.maxFeeRaw,
        params.minFinalityThreshold,
        params.hookData,
      ],
    });

    return {
      kind: "evm_transaction",
      chain: fromChain,
      to: TOKEN_MESSENGER_V2,
      data,
      value: "0",
      approval: {
        token: usdc,
        spender: TOKEN_MESSENGER_V2,
        amountRaw: params.amountRaw.toString(),
      },
    };
  }

  // ── status ────────────────────────────────────────────────────────────

  /**
   * CCTP produces only `completed` or `failed`: burn-and-mint is atomic
   * per message, so there is no `PARTIAL` and no `REFUNDED` analogue
   * (§7.7.1). Normalising onto the same four-value enum is what keeps the
   * progress card provider-agnostic.
   *
   * Attestation state comes from Circle's public Iris API, which needs no
   * API key for reads.
   */
  async status(ref: BridgeRef): Promise<BridgeStatus> {
    const source = this.evmSourceOf(ref.fromChain);
    if (!source) {
      throw new DefiError("unsupported_chain", "unknown cctp source");
    }

    const network = this.stellarNetworkOf(ref.toChain);
    const base =
      network === "testnet"
        ? "https://iris-api-sandbox.circle.com"
        : "https://iris-api.circle.com";

    try {
      const res = await fetch(
        `${base}/v2/messages/${source.domain}?transactionHash=${encodeURIComponent(ref.sourceTxHash)}`,
      );
      if (!res.ok) {
        // Not indexed yet is the common case right after submit; it is not
        // an error state. Log the status, never surface it.
        this.logger.debug(
          `[status] iris returned ${res.status} for ${ref.sourceTxHash}`,
        );
        return {
          outcome: null,
          phase: "pending_source",
          currentStepKey: "burn",
          sourceTxHash: ref.sourceTxHash,
        };
      }
      const body = (await res.json()) as {
        messages?: Array<{ status?: string; attestation?: string }>;
      };
      const message = body.messages?.[0];
      const attested =
        message?.status === "complete" &&
        typeof message.attestation === "string" &&
        message.attestation !== "PENDING";

      return {
        outcome: attested ? "completed" : null,
        phase: attested ? "settled" : "pending_attestation",
        currentStepKey: attested ? "mint" : "attestation",
        sourceTxHash: ref.sourceTxHash,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[status] iris unreachable: ${detail}`);
      throw new DefiError("network_error", detail);
    }
  }

  // ── support matrix ────────────────────────────────────────────────────

  async listSupportedChains(): Promise<BridgeSupportedChain[]> {
    const rows: BridgeSupportedChain[] = [];

    for (const network of ["pubnet", "testnet"] as StellarCctpNetwork[]) {
      if (!isStellarCctpEnabled(network)) continue;
      rows.push({
        chain: `stellar:${network}`,
        name: network === "pubnet" ? "Stellar" : "Stellar Testnet",
        providers: [this.key],
        nativeSymbol: "XLM",
      });
    }

    // Only advertise the EVM sources when at least one Stellar side is
    // actually open — otherwise this adapter contributes nothing and
    // listing them would imply a route that does not exist.
    if (rows.length > 0) {
      for (const [chainId, source] of Object.entries(EVM_SOURCES)) {
        rows.push({
          chain: `eip155:${chainId}`,
          name: source.name,
          providers: [this.key],
        });
      }
    }

    return rows;
  }

  async listTools(): Promise<string[]> {
    // Single-mechanism adapter: it aggregates nothing.
    return [];
  }

  async resolveToken(asset: Caip19): Promise<BridgeToken | null> {
    if (!this.isUsdc(asset)) return null;
    const parsed = parseCaip19(asset);
    if (!parsed) return null;

    if (parsed.chainNamespace === "stellar") {
      const network = this.stellarNetworkOf(parsed.chain);
      return network ? this.stellarUsdcToken(parsed.chain, network) : null;
    }
    const source = this.evmSourceOf(parsed.chain);
    return source ? this.evmUsdcToken(parsed.chain, source.usdc) : null;
  }

  private evmUsdcToken(chain: Caip2, usdc: `0x${string}`): BridgeToken {
    return {
      caip19: buildCaip19(chain, "erc20", usdc),
      chain,
      address: usdc,
      symbol: "USDC",
      name: "USD Coin",
      decimals: EVM_USDC_DECIMALS,
      isNative: false,
      verification: "verified",
    };
  }

  private stellarUsdcToken(
    chain: Caip2,
    network: StellarCctpNetwork,
  ): BridgeToken {
    const asset = STELLAR_USDC[network];
    return {
      // CAIP-19 constrains `asset_namespace` to `[-a-z0-9]{3,8}`, so the
      // descriptive `credit_alphanum4` is not legal, and its
      // `asset_reference` grammar excludes the colon, so `CODE:ISSUER`
      // is encoded with a hyphen (Stellar's own canonical display form).
      caip19: buildCaip19(chain, "asset", asset.replace(":", "-")),
      chain,
      address: asset,
      symbol: "USDC",
      name: "USD Coin",
      // SEVEN, not six. Sourced here rather than from a shared constant —
      // see §5.4.1 / §6.
      decimals: STELLAR_USDC_DECIMALS,
      isNative: false,
      verification: "verified",
    };
  }

  /**
   * Deliberately NO `gasTopUp`. Stellar's destination precondition is a
   * TRUSTLINE plus an XLM base reserve, not gas, and a trustline is a hard
   * opt-in the recipient must perform themselves — no amount of
   * sender-side signing can complete a transfer to an account that hasn't
   * opted in. The remedy is `ensureTrustline` on the user's own wallet,
   * which mobile surfaces via `checkDestinationReadiness` (§7.5). Omitting
   * the method is the correct signal, not an oversight (§5.2).
   *
   * Note also that Stellar has NO Forwarding Service (§7.5.1), so the
   * readiness warning is mandatory here rather than optional.
   */

  /** Exposed for the readiness path so mobile can name the exact contract. */
  forwarderFor(network: StellarCctpNetwork): string {
    return STELLAR_CCTP_CONTRACTS[network].forwarder;
  }
}
