/**
 * Bridge service — dispatches through the adapter registry, never a switch.
 *
 * Spec: docs/bridge-capability-spec.md §5.2, §5.3, §7.6.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DefiError } from "../strategies/errors/defi-error";
import { chainOfAsset } from "./caip";
import {
  type BridgeRouteAdapter,
  listBridgeAdapters,
  resolveBridgeAdapters,
} from "./registry";
import type {
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeRef,
  BridgeStatus,
  BridgeSupport,
  BridgeSupportedChain,
  Caip19,
  Caip2,
  GasTopUpRequest,
} from "./types";

/**
 * Why a route is unavailable. Every value is a CAPABILITY BOUNDARY, not a
 * failure — the card renders a plain explanatory state rather than an
 * error card, with no raw provider text (§7.6).
 */
export type NoRouteReason =
  | "same_chain"
  | "chain_not_supported"
  | "asset_not_supported"
  | "asset_chain_mismatch"
  | "no_route_found"
  | "check_unavailable";

export type BridgeQuoteResult =
  | { routable: true; quote: BridgeQuote }
  | { routable: false; reason: NoRouteReason };

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  /**
   * The queried support matrix (§5.3).
   *
   * Consequence of querying rather than hardcoding: Circle adding a CCTP
   * domain, or LI.FI adding a bridge, lights up for us with NO DEPLOY and
   * no code change. That is also why Arc graduating to CCTP mainnet needs
   * nothing from us (§10.7).
   */
  async getSupport(): Promise<BridgeSupport> {
    const adapters = listBridgeAdapters();
    const byChain = new Map<Caip2, BridgeSupportedChain>();
    const providers: BridgeSupport["providers"] = [];
    let degraded = false;

    for (const adapter of adapters) {
      let chains: BridgeSupportedChain[] = [];
      let tools: string[] = [];
      try {
        [chains, tools] = await Promise.all([
          adapter.listSupportedChains(),
          adapter.listTools(),
        ]);
      } catch (error: unknown) {
        // A cold or failed fetch degrades to "we could not check routes
        // right now", NEVER to a wrong "unsupported" (§5.3).
        degraded = true;
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[getSupport] ${adapter.key} unavailable: ${detail}`);
        continue;
      }

      // Presence-checked optional capability, same discipline as
      // `gasTopUp` — an adapter that cannot report staleness simply
      // doesn't, and we don't claim it is fresh.
      const reporter = adapter as BridgeRouteAdapter & {
        isDegraded?: () => boolean;
      };
      if (typeof reporter.isDegraded === "function") {
        degraded = degraded || reporter.isDegraded() === true;
      }

      providers.push({ key: adapter.key, tools });

      for (const row of chains) {
        const existing = byChain.get(row.chain);
        if (existing) {
          for (const p of row.providers) {
            if (!existing.providers.includes(p)) existing.providers.push(p);
          }
        } else {
          byChain.set(row.chain, { ...row, providers: [...row.providers] });
        }
      }
    }

    return {
      chains: [...byChain.values()].sort((a, b) => a.name.localeCompare(b.name)),
      providers,
      refreshedAt: new Date().toISOString(),
      degraded,
    };
  }

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuoteResult> {
    if (req.fromChain === req.toChain) {
      return { routable: false, reason: "same_chain" };
    }

    // An asset id carries its own chain; a mismatch is a caller bug that
    // would otherwise quote a route for the wrong pair entirely.
    if (chainOfAsset(req.fromAsset) !== req.fromChain) {
      return { routable: false, reason: "asset_chain_mismatch" };
    }
    if (chainOfAsset(req.toAsset) !== req.toChain) {
      return { routable: false, reason: "asset_chain_mismatch" };
    }

    const candidates = resolveBridgeAdapters(
      req.fromChain,
      req.toChain,
      req.fromAsset,
      req.toAsset,
    );

    if (candidates.length === 0) {
      // Distinguish "we don't reach that chain" from "we reach it but not
      // with that asset" so the card can say something true. A non-USDC
      // asset on Stellar is the canonical example (§3.2).
      const chainReachable = listBridgeAdapters().some((a) =>
        a.supports(req.fromChain, req.toChain),
      );
      return {
        routable: false,
        reason: chainReachable ? "asset_not_supported" : "chain_not_supported",
      };
    }

    let lastError: unknown = null;
    for (const adapter of candidates) {
      try {
        const quote = await adapter.quote(req);
        return { routable: true, quote };
      } catch (error: unknown) {
        lastError = error;
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[quote] ${adapter.key} declined: ${detail}`);
      }
    }

    // Every eligible adapter declined. A provider outage and a genuinely
    // unroutable pair are different states, so a network failure surfaces
    // as "we could not check" rather than a confident "unsupported".
    if (lastError instanceof DefiError && lastError.code === "network_error") {
      return { routable: false, reason: "check_unavailable" };
    }
    return { routable: false, reason: "no_route_found" };
  }

  async status(ref: BridgeRef): Promise<BridgeStatus> {
    const candidates = ref.provider
      ? listBridgeAdapters().filter((a) => a.key === ref.provider)
      : resolveBridgeAdapters(ref.fromChain, ref.toChain);

    if (candidates.length === 0) {
      throw new DefiError("unsupported_chain", "no adapter for this route");
    }

    let lastError: unknown = null;
    for (const adapter of candidates) {
      try {
        return await adapter.status(ref);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof DefiError
      ? lastError
      : new DefiError("network_error", "bridge status unavailable");
  }

  /**
   * Optional capability, presence-checked (§5.2 space docking).
   *
   * An adapter that cannot top up gas simply omits `gasTopUp`. So does one
   * whose routes carry no strand risk because the provider pays the
   * destination leg (Circle's Forwarding Service, §7.5.1) — the absence IS
   * the correct signal, not an omission to work around.
   */
  async gasTopUp(req: GasTopUpRequest): Promise<BridgeQuote> {
    const candidates = resolveBridgeAdapters(req.fromChain, req.chain).filter(
      (a) => typeof a.gasTopUp === "function",
    );
    if (candidates.length === 0) {
      throw new DefiError("unsupported_chain", "no gas top up route");
    }
    let lastError: unknown = null;
    for (const adapter of candidates) {
      try {
        // biome-ignore lint/style/noNonNullAssertion: filtered on presence above
        return await adapter.gasTopUp!(req);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof DefiError
      ? lastError
      : new DefiError("network_error", "gas top up unavailable");
  }

  /** Token metadata (symbol + DECIMALS) for a CAIP-19, via any adapter. */
  async resolveToken(asset: Caip19) {
    const chain = chainOfAsset(asset);
    if (!chain) return null;
    for (const adapter of listBridgeAdapters()) {
      const token = await adapter.resolveToken(asset).catch(() => null);
      if (token) return token;
    }
    return null;
  }
}
