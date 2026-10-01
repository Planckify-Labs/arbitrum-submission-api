/**
 * Bridge service — dispatches through the adapter registry, never a switch.
 *
 * Spec: docs/bridge-capability-spec.md §5.2, §5.3, §7.6.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { alchemyNetworkForChainId } from "../alchemy/alchemy-networks";
import {
  buildCaip2Id,
  type TBlockchainRow,
} from "../blockchains/blockchain-enricher";
import { PrismaService } from "../prisma/prisma.service";
import { AlchemyPricesClient } from "../strategies/external/alchemy-prices.client";
import { DefiError } from "../strategies/errors/defi-error";
import { chainOfAsset, isNativeAsset, parseCaip19 } from "./caip";
import { CircleAppKitClient } from "./providers/circle/app-kit.client";
import { caip2ForCircleChain } from "./providers/circle/circle-route";
import {
  type BridgeRouteAdapter,
  listBridgeAdapters,
  resolveBridgeAdapters,
} from "./registry";
import type {
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeToken,
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
  | "chain_not_enabled"
  | "asset_not_supported"
  | "asset_chain_mismatch"
  | "no_route_found"
  | "check_unavailable";

export type BridgeQuoteResult =
  | { routable: true; quote: BridgeQuote }
  | { routable: false; reason: NoRouteReason };

/** Providers quoted side by side per specificity tier (swap spec §4.3). */
const ARBITRATION_WIDTH = 2;

/** A quote's guaranteed floor; a malformed one ranks last, never first. */
function floorOf(quote: BridgeQuote): bigint {
  try {
    return BigInt(quote.toAmountMinRaw);
  } catch {
    return -1n;
  }
}

/** How long the trusted-token set is reused. Issuer pins change by release. */
const TRUSTED_TOKENS_TTL_MS = 5 * 60_000;

/**
 * Identity key for a token contract on a chain. EVM hex folds; every other
 * encoding (base58 mints, Sui coin types, Stellar CODE:ISSUER) is compared
 * verbatim (`feedback_address_case_per_encoding`).
 */
function tokenKey(caip2: string, reference: string): string {
  return `${caip2}|${caip2.startsWith("eip155:") ? reference.toLowerCase() : reference}`;
}

/** How long the enabled-chain set is reused before re-reading the rows. */
const ENABLED_CHAINS_TTL_MS = 60_000;

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);
  private enabledChainsCache: { at: number; chains: Set<Caip2> } | null = null;

  private trustedTokensCache: { at: number; keys: Set<string> } | null = null;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly circle?: CircleAppKitClient,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly prices?: AlchemyPricesClient,
  ) {}

  /**
   * The swap routing policy, from config (a feature flag, flipped without a
   * release):
   *
   *  - `SWAP_PREFERRED_SYMBOLS`: tokens whose same-chain swaps are routed
   *    by the policy (default `USDC,EURC,cirBTC`; empty turns it off).
   *  - `SWAP_PREFERRED_PROVIDERS`: the providers for those swaps, in order;
   *    each later one is the fallback (default `tower,lifi`: Tower for the
   *    co-marketing, LI.FI when Tower cannot route or on chains Tower does
   *    not serve). After the co-marketing: `lifi`.
   *  - `ROUTE_POLICY_ONLY_PROVIDERS`: providers reachable ONLY through the
   *    policy above, never for any other swap (default `tower`: Tower is a
   *    co-marketing lane for the preferred tokens, not a general router).
   *    Every other token goes to open arbitration (LI.FI today), so the
   *    app swaps whatever the providers can, unlocked by default.
   *  - `DISABLED_ROUTE_PROVIDERS`: providers taken out of routing entirely,
   *    for any route (default none). Retiring Tower is `tower`; it is also
   *    the ops kill switch for a provider during an incident (swap spec
   *    §8.4 L3). Status reads for transfers already submitted still work.
   */
  private swapPolicy(): {
    symbols: Set<string>;
    providers: string[];
    policyOnly: Set<string>;
    disabled: Set<string>;
  } {
    const list = (key: string, fallback: string): string[] =>
      (this.config?.get<string>(key) ?? fallback)
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    return {
      symbols: new Set(
        list("SWAP_PREFERRED_SYMBOLS", "USDC,EURC,cirBTC").map((s) =>
          s.toUpperCase(),
        ),
      ),
      providers: list("SWAP_PREFERRED_PROVIDERS", "tower,lifi"),
      policyOnly: new Set(list("ROUTE_POLICY_ONLY_PROVIDERS", "tower")),
      disabled: new Set(list("DISABLED_ROUTE_PROVIDERS", "")),
    };
  }

  /**
   * Does either side of this swap carry a preferred token? A side counts
   * only when BOTH hold:
   *
   *  - its contract reports a preferred symbol (via the preferred adapters'
   *    `resolveToken`), and
   *  - that exact contract on that chain is one we vouch for
   *    (`trustedTokens`: Circle's pins, then our Token rows), or the
   *    chain's own native asset.
   *
   * A symbol is not an identity: anyone can deploy a token called "USDC"
   * on any chain, and every asset has its own address per chain. Matching
   * on the symbol alone let a lookalike ride the co-marketing lane and
   * pick up its trust. A preferred token with no vouched address on a
   * chain (no Circle pin, no Token row) simply takes the open route there,
   * where the device asks the user to confirm an unverified token.
   * It only picks a provider: every quote still passes the device's quote
   * binding, router allowlist and pre-sign checks.
   */
  private async isPreferredSwap(
    req: BridgeQuoteRequest,
    policy: { symbols: Set<string> },
    preferred: readonly BridgeRouteAdapter[],
  ): Promise<boolean> {
    if (policy.symbols.size === 0) return false;
    let trusted: Set<string> | null = null;
    for (const asset of [req.fromAsset, req.toAsset]) {
      const parsed = parseCaip19(asset);
      if (!parsed) continue;
      if (!isNativeAsset(asset)) {
        if (!parsed.assetReference) continue;
        trusted ??= await this.trustedTokens();
        if (!trusted.has(tokenKey(parsed.chain, parsed.assetReference))) continue;
      }
      let token: BridgeToken | null = null;
      for (const adapter of preferred) {
        token = await adapter.resolveToken(asset).catch(() => null);
        if (token) break;
      }
      if (token?.symbol && policy.symbols.has(token.symbol.toUpperCase())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Tokens whose identity WE can vouch for, strongest source first:
   *
   *  1. the ISSUER's own pins: Circle's USDC and EURC contracts per chain,
   *     from App Kit's chain definitions (the same pins the Circle adapters
   *     build against);
   *  2. our own token catalogue: the active `Token` rows the app lists.
   *
   * A provider's opinion ranks below both. LI.FI marks every Arc token
   * `unverified` (live 2026-09-30: Circle's own EURC and USDC on Arc)
   * simply because it has not reviewed Arc yet; relaying that as "not a
   * verified token" warned users off the genuine asset.
   */
  private async trustedTokens(): Promise<Set<string>> {
    const cached = this.trustedTokensCache;
    if (cached && Date.now() - cached.at < TRUSTED_TOKENS_TTL_MS) {
      return cached.keys;
    }
    const keys = new Set<string>();
    try {
      for (const def of this.circle?.bridgeChains() ?? []) {
        const caip2 = caip2ForCircleChain(def);
        if (!caip2) continue;
        for (const address of [def.usdcAddress, def.eurcAddress]) {
          if (address) keys.add(tokenKey(caip2, address));
        }
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[trustedTokens] issuer pins unavailable: ${detail}`);
    }
    try {
      const rows =
        (await this.prisma?.token.findMany({
          where: {
            isActive: true,
            contractAddress: { not: null },
            blockchain: { isActive: true },
          },
          select: {
            contractAddress: true,
            blockchain: {
              select: { chainId: true, chainSlug: true, type: true, name: true },
            },
          },
        })) ?? [];
      for (const row of rows) {
        const caip2 = buildCaip2Id(row.blockchain as unknown as TBlockchainRow);
        if (caip2 && row.contractAddress) {
          keys.add(tokenKey(caip2, row.contractAddress));
        }
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[trustedTokens] token rows unavailable: ${detail}`);
      // Keep the last good catalogue rather than downgrading every token.
      for (const key of cached?.keys ?? []) keys.add(key);
    }
    this.trustedTokensCache = { at: Date.now(), keys };
    return keys;
  }

  /**
   * USD values (and a token logo) for a quote's sides, when the provider
   * left them out (Tower quotes carry neither; LI.FI's carry both). Display
   * only, never an input to routing or safety: a missing price leaves the
   * field absent, never 0.
   *
   * Sources, in order:
   *  1. Alchemy Prices, the cached and budgeted client the DeFi screens use
   *     (needs `ALCHEMY_API_KEY`: it is a REST API, not JSON-RPC, so it
   *     cannot ride the rpc proxy);
   *  2. any adapter whose `resolveToken` carries a price or logo for the
   *     token (presence-checked, so no provider is named here). Keyless.
   */
  private async fillUsd(quote: BridgeQuote): Promise<BridgeQuote> {
    const sides = [quote.from, quote.to] as const;
    const needs = sides.some((side) => !side.amountUsd || !side.token.logoUri);
    if (!needs) return quote;

    const alchemyPrice = new Map<string, number>();
    if (this.prices) {
      const wanted = sides.flatMap((side) => {
        if (side.amountUsd || !side.token.address) return [];
        const parsed = parseCaip19(side.token.caip19);
        const chainId = Number(parsed?.chainReference);
        if (parsed?.chainNamespace !== "eip155" || !Number.isInteger(chainId)) {
          return [];
        }
        const network = alchemyNetworkForChainId(chainId);
        return network ? [{ network, address: side.token.address }] : [];
      });
      if (wanted.length > 0) {
        const found = await this.prices
          .getPricesByAddress(wanted)
          .catch(() => new Map<string, number | null>());
        for (const w of wanted) {
          const price = found.get(`${w.network}:${w.address.toLowerCase()}`);
          if (typeof price === "number" && Number.isFinite(price)) {
            alchemyPrice.set(w.address.toLowerCase(), price);
          }
        }
      }
    }

    const enrich = async (side: BridgeQuote["from"]) => {
      let price = side.token.address
        ? alchemyPrice.get(side.token.address.toLowerCase())
        : undefined;
      let logoUri = side.token.logoUri;
      if ((side.amountUsd || price !== undefined) && logoUri) {
        return { price, logoUri };
      }
      for (const adapter of listBridgeAdapters()) {
        const token = await adapter.resolveToken(side.token.caip19).catch(() => null);
        if (!token) continue;
        if (price === undefined && token.priceUsd) {
          const p = Number.parseFloat(token.priceUsd);
          if (Number.isFinite(p) && p > 0) price = p;
        }
        logoUri ??= token.logoUri;
        if ((side.amountUsd || price !== undefined) && logoUri) break;
      }
      return { price, logoUri };
    };

    const usd = (side: BridgeQuote["from"], price: number | undefined) => {
      if (side.amountUsd) return side.amountUsd;
      if (price === undefined) return undefined;
      const amount = Number(side.amountRaw) / 10 ** side.token.decimals;
      return Number.isFinite(amount) ? (amount * price).toFixed(2) : undefined;
    };

    const [from, to] = await Promise.all([enrich(quote.from), enrich(quote.to)]);
    const fromUsd = usd(quote.from, from.price);
    const toUsd = usd(quote.to, to.price);
    return {
      ...quote,
      from: {
        ...quote.from,
        ...(fromUsd ? { amountUsd: fromUsd } : {}),
        token: { ...quote.from.token, ...(from.logoUri ? { logoUri: from.logoUri } : {}) },
      },
      to: {
        ...quote.to,
        ...(toUsd ? { amountUsd: toUsd } : {}),
        token: { ...quote.to.token, ...(to.logoUri ? { logoUri: to.logoUri } : {}) },
      },
    };
  }

  /** Display enrichment for a winning quote: identity trust, then USD. */
  private async enrichQuote(quote: BridgeQuote): Promise<BridgeQuote> {
    return this.fillUsd(await this.applyTokenTrust(quote));
  }

  /** Upgrade a quote's tokens to `verified` where we can vouch for them. */
  private async applyTokenTrust(quote: BridgeQuote): Promise<BridgeQuote> {
    const trusted = await this.trustedTokens();
    const vouch = (token: BridgeToken): BridgeToken => {
      if (token.verification === "verified") return token;
      const parsed = parseCaip19(token.caip19);
      if (!parsed?.assetReference) return token;
      return trusted.has(tokenKey(parsed.chain, parsed.assetReference))
        ? { ...token, verification: "verified" }
        : token;
    };
    return {
      ...quote,
      from: { ...quote.from, token: vouch(quote.from.token) },
      to: { ...quote.to, token: vouch(quote.to.token) },
    };
  }

  /**
   * Chain reach is OURS, intersected with the provider's (swap spec §4.7):
   * the CAIP-2 ids of our active `Blockchain` rows, the same source
   * `GET /blockchains` serves the app, so the matrix and the app's chain
   * list cannot disagree. Adding a chain is a row, never a deploy.
   *
   * `null` means "could not read": callers degrade, never answer "we
   * support nothing". A last good read is reused over a failed one.
   */
  private async enabledChains(): Promise<Set<Caip2> | null> {
    const cached = this.enabledChainsCache;
    if (cached && Date.now() - cached.at < ENABLED_CHAINS_TTL_MS) {
      return cached.chains;
    }
    if (!this.prisma) return cached?.chains ?? null;
    try {
      const rows = await this.prisma.blockchain.findMany({
        where: { isActive: true },
        select: { chainId: true, chainSlug: true, type: true, name: true },
      });
      const chains = new Set<Caip2>();
      for (const row of rows) {
        const caip2 = buildCaip2Id(row as unknown as TBlockchainRow);
        if (caip2) chains.add(caip2);
      }
      this.enabledChainsCache = { at: Date.now(), chains };
      return chains;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[enabledChains] row read failed: ${detail}`);
      return cached?.chains ?? null;
    }
  }

  /**
   * The queried support matrix (§5.3).
   *
   * Consequence of querying rather than hardcoding: LI.FI adding a bridge
   * lights up with NO DEPLOY, and Circle adding a CCTP domain lights up on
   * an App Kit version bump with no table of ours to edit. (Arc mainnet
   * reaches us through `circle-cctp`, not LI.FI, which lists Arc but
   * serves no route on it; see §10.7.)
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

    // A provider's reach is an upper bound, never the offer (§4.7).
    const enabled = await this.enabledChains();
    if (enabled === null) degraded = true;
    const offered = [...byChain.values()].filter(
      (row) => enabled === null || enabled.has(row.chain),
    );

    return {
      chains: offered.sort((a, b) => a.name.localeCompare(b.name)),
      providers,
      refreshedAt: new Date().toISOString(),
      degraded,
    };
  }

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuoteResult> {
    // A same-chain request is a swap. It is routable only where an adapter
    // explicitly serves one (`tower` on Arc); everywhere else it stays the
    // `same_chain` capability boundary, decided below by `supports()`
    // rather than a chain list here.

    // An asset id carries its own chain; a mismatch is a caller bug that
    // would otherwise quote a route for the wrong pair entirely.
    if (chainOfAsset(req.fromAsset) !== req.fromChain) {
      return { routable: false, reason: "asset_chain_mismatch" };
    }
    if (chainOfAsset(req.toAsset) !== req.toChain) {
      return { routable: false, reason: "asset_chain_mismatch" };
    }

    // A route may only touch chains we serve (§4.7). An unreadable row
    // set does not block here: the device enforces the same rule against
    // the list it holds, so one anchor always stands.
    const enabled = await this.enabledChains();
    if (
      enabled !== null &&
      (!enabled.has(req.fromChain) || !enabled.has(req.toChain))
    ) {
      return { routable: false, reason: "chain_not_enabled" };
    }

    let candidates = resolveBridgeAdapters(
      req.fromChain,
      req.toChain,
      req.fromAsset,
      req.toAsset,
    );

    // Swap routing policy (co-marketing), config not code: a same-chain
    // swap touching a preferred token goes ONLY to the preferred providers,
    // tried in the configured order, the next one being the fallback. No
    // open arbitration and no generalist for these routes. Swapping the
    // order, or the provider, is an env change.
    const policy = this.swapPolicy();
    // A disabled provider takes no new routes at all (retired, or killed
    // during an incident). Status reads are unaffected.
    candidates = candidates.filter((a) => !policy.disabled.has(a.key));
    // Only providers that serve THIS route count, so the symbol lookup
    // (on-chain reads) happens only where the policy could apply at all.
    const preferred =
      req.fromChain === req.toChain
        ? policy.providers.flatMap((key) => {
            const adapter = candidates.find((a) => a.key === key);
            return adapter ? [adapter] : [];
          })
        : [];
    if (preferred.length > 0 && (await this.isPreferredSwap(req, policy, preferred))) {
      let lastPolicyError: unknown = null;
      for (const adapter of preferred) {
        try {
          const quote = await adapter.quote(req);
          return { routable: true, quote: await this.enrichQuote(quote) };
        } catch (error: unknown) {
          lastPolicyError = error;
          const detail = error instanceof Error ? error.message : String(error);
          this.logger.warn(`[quote] preferred ${adapter.key} declined: ${detail}`);
        }
      }
      if (lastPolicyError instanceof DefiError && lastPolicyError.code === "network_error") {
        return { routable: false, reason: "check_unavailable" };
      }
      return { routable: false, reason: "no_route_found" };
    }
    // Policy-only providers (Tower) serve the policy's tokens and nothing
    // else: every other swap is open arbitration among general routers.
    candidates = candidates.filter((a) => !policy.policyOnly.has(a.key));

    if (candidates.length === 0) {
      if (req.fromChain === req.toChain) {
        return { routable: false, reason: "same_chain" };
      }
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

    // Arbitration (swap spec §4.3). Candidates come sorted specific-first,
    // then by registration order. Within one specificity tier, quote up to
    // ARBITRATION_WIDTH in parallel and keep the best GUARANTEED floor
    // (`toAmountMinRaw`), not the best estimate: ranking on the optimistic
    // number rewards the loosest slippage. Ties go to the earlier adapter.
    // A specialist tier (Circle for its own stablecoins, §4.10) is never
    // raced against the generalists; they are its fallback, tried only
    // when every specialist declines.
    let lastError: unknown = null;
    let i = 0;
    while (i < candidates.length) {
      const specific = Boolean(candidates[i].supportsAsset);
      const batch: BridgeRouteAdapter[] = [];
      while (
        i < candidates.length &&
        batch.length < ARBITRATION_WIDTH &&
        Boolean(candidates[i].supportsAsset) === specific
      ) {
        batch.push(candidates[i++]);
      }
      const settled = await Promise.allSettled(batch.map((a) => a.quote(req)));
      let best: BridgeQuote | null = null;
      settled.forEach((result, idx) => {
        if (result.status === "rejected") {
          lastError = result.reason;
          const detail =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          this.logger.warn(`[quote] ${batch[idx].key} declined: ${detail}`);
          return;
        }
        if (!best || floorOf(result.value) > floorOf(best)) best = result.value;
      });
      if (best) {
        return { routable: true, quote: await this.enrichQuote(best) };
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
    let candidates = ref.provider
      ? listBridgeAdapters().filter(
          (a) =>
            a.key === ref.provider ||
            (ref.provider === "circle" && a.key.startsWith("circle")),
        )
      : [];

    if (candidates.length === 0) {
      candidates = resolveBridgeAdapters(ref.fromChain, ref.toChain);
    }

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

  /**
   * Tokens on a chain matching a symbol, name or address, from the
   * providers' own lists (adapters with `searchTokens`, presence-checked).
   * Only on chains we serve (§4.7), and with our identity trust applied:
   * a result reads `verified` only when the issuer pins it or our catalogue
   * lists it, whatever the provider says.
   */
  async searchTokens(chain: Caip2, query: string): Promise<BridgeToken[]> {
    const enabled = await this.enabledChains();
    if (enabled !== null && !enabled.has(chain)) return [];
    const disabled = this.swapPolicy().disabled;
    const seen = new Set<string>();
    const out: BridgeToken[] = [];
    const trusted = await this.trustedTokens();
    const vouch = (token: BridgeToken): BridgeToken => {
      const parsed = parseCaip19(token.caip19);
      return parsed?.assetReference &&
        trusted.has(tokenKey(parsed.chain, parsed.assetReference))
        ? { ...token, verification: "verified" }
        : token;
    };

    // An exact asset id: is it a real token on this chain? Any adapter that
    // can read it answers (on-chain metadata for Tower, the token list for
    // LI.FI), so a token only one provider knows still resolves. This is
    // what lets the device refuse an id the model made up.
    if (parseCaip19(query)) {
      if (chainOfAsset(query) !== chain) return [];
      const token = await this.resolveToken(query).catch(() => null);
      return token ? [vouch(token)] : [];
    }

    for (const adapter of listBridgeAdapters()) {
      if (!adapter.searchTokens || disabled.has(adapter.key)) continue;
      const found = await adapter.searchTokens(chain, query).catch(() => []);
      for (const token of found) {
        const key = token.caip19.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(vouch(token));
      }
    }
    return out.slice(0, 8);
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
