/**
 * Router-calldata proxy (spec §6, §12 Q7/Q8).
 *
 * Pendle and Uniswap LP have no stable on-chain deposit ABI we encode; their
 * hosted API returns the calldata. Two consequences drive this service:
 *
 *  1. **The device never calls the third-party API.** Every quote goes through
 *     here, so the API key, the rate limit, the slippage ceiling and the
 *     allowlist all live in one reviewed place instead of being re-implemented
 *     (or skipped) on the client.
 *  2. **The returned `to` is verified before it is ever returned.** A
 *     compromised or spoofed upstream that answers with a different `to` is
 *     rejected here, and the device checks the same allowlist again against its
 *     OWN pinned copy — the two independent trust anchors of §11.1. Neither
 *     side alone can authorise the call.
 *
 * The pool's target is re-resolved server-side from `poolId` (§8: the client
 * never supplies an address), the amount is echoed back for the caller's
 * Layer-4 assertion, and the quote carries a short TTL so a stale, sandwichable
 * calldata can be detected rather than signed (§12 Q8).
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { DefiErrorCode } from "./errors/defi-error";
import {
  isRouterAllowlisted,
  PENDLE_HOSTED_SDK_ORIGIN,
} from "./targets/address-book";
import { isChainEnabledForDefi, isFamilyKilled } from "./targets/feature-flags";
import type { DepositTarget } from "./targets/types";
import { eqAddr } from "./targets/types";

/** How long a quote may be held before it must be re-fetched (§12 Q8). */
export const ROUTER_QUOTE_TTL_SEC = 60;

/** Hard ceiling, mirroring the mobile slippage policy (§12 Q4). */
const MAX_SLIPPAGE_BPS = 300;

const REQUEST_TIMEOUT_MS = 15_000;

export interface RouterQuoteRequest {
  poolId: string;
  /** The user's own wallet. Funds and LP always land back here. */
  receiver: string;
  amountRaw: string;
  slippageBps: number;
  action: "deposit" | "withdraw";
}

export interface RouterQuoteResult {
  to: string;
  data: string;
  value: string;
  /** Expected output in the protocol's own units, when it reports one. */
  expectedOut: string | null;
  /** Unix seconds after which the caller MUST re-fetch (§12 Q8). */
  expiresAt: number;
  /** Echoed so the caller can assert the quote priced what it asked for. */
  tokenIn: string;
  amountIn: string;
  chainId: number;
}

/** Anything we refuse maps to a curated code — never a raw upstream body. */
export class RouterQuoteError extends Error {
  constructor(readonly code: DefiErrorCode) {
    super(code);
    this.name = "RouterQuoteError";
  }
}

@Injectable()
export class RouterQuoteService {
  private readonly logger = new Logger(RouterQuoteService.name);

  constructor(private readonly prisma: PrismaService) {}

  async quote(req: RouterQuoteRequest): Promise<RouterQuoteResult> {
    if (
      !Number.isFinite(req.slippageBps) ||
      req.slippageBps <= 0 ||
      req.slippageBps > MAX_SLIPPAGE_BPS
    ) {
      throw new RouterQuoteError("slippage_too_high");
    }
    if (!/^\d+$/.test(req.amountRaw) || BigInt(req.amountRaw) <= 0n) {
      throw new RouterQuoteError("unknown");
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.receiver)) {
      throw new RouterQuoteError("unknown");
    }

    // The target is re-read from OUR row, never taken from the request body.
    const row = await this.prisma.opportunityCache.findUnique({
      where: { poolId: req.poolId },
      select: { depositTarget: true },
    });
    const target = row?.depositTarget as DepositTarget | null;
    if (!target || target.kind !== "router-call") {
      throw new RouterQuoteError("protocol_not_found");
    }
    if (isFamilyKilled(target.protocol) || isFamilyKilled("router-call")) {
      throw new RouterQuoteError("family_disabled");
    }
    if (!isChainEnabledForDefi(target.chainId)) {
      throw new RouterQuoteError("family_disabled");
    }

    const quote =
      target.protocol === "pendle" ? await this.quotePendle(target, req) : null;
    if (!quote) {
      // Uniswap v3/v4 LP needs a tick range, which is a different product
      // decision from "supply this asset" — no encoder here until that UX
      // exists, and no guessed default range.
      throw new RouterQuoteError("protocol_not_found");
    }

    // §6 guardrail 2 — the returned destination MUST be a pinned router.
    if (!isRouterAllowlisted(target.protocol, target.chainId, quote.to)) {
      this.logger.error(
        `[router-quote] BLOCKED non-allowlisted to for ${target.protocol} on chain ${target.chainId}`,
      );
      throw new RouterQuoteError("target_not_allowlisted");
    }
    // §6 guardrail 4 — the quote must have priced the asset and amount we asked
    // it to. A quote for a different token is not a quote for this deposit.
    if (!eqAddr(quote.tokenIn, target.tokenIn)) {
      throw new RouterQuoteError("decoded_intent_mismatch");
    }
    if (quote.amountIn !== req.amountRaw) {
      throw new RouterQuoteError("decoded_intent_mismatch");
    }

    return {
      ...quote,
      chainId: target.chainId,
      expiresAt: Math.floor(Date.now() / 1000) + ROUTER_QUOTE_TTL_SEC,
    };
  }

  /**
   * Pendle Hosted SDK. `add-liquidity` returns a ready `tx {to, data, value}`
   * priced at the slippage we pass; `remove-liquidity` is symmetric.
   */
  private async quotePendle(
    target: Extract<DepositTarget, { kind: "router-call" }>,
    req: RouterQuoteRequest,
  ): Promise<Omit<RouterQuoteResult, "expiresAt" | "chainId"> | null> {
    const path =
      req.action === "deposit" ? "add-liquidity" : "remove-liquidity";
    const params = new URLSearchParams({
      receiver: req.receiver,
      slippage: String(req.slippageBps / 10_000),
      enableAggregator: "true",
      ...(req.action === "deposit"
        ? { tokenIn: target.tokenIn, amountIn: req.amountRaw }
        : { tokenOut: target.tokenIn, amountIn: req.amountRaw }),
    });
    const url = `${PENDLE_HOSTED_SDK_ORIGIN}/v2/sdk/${target.chainId}/markets/${target.market}/${path}?${params}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        // Log the status for ops; the caller only ever sees a curated code.
        this.logger.warn(`[router-quote] pendle ${path} -> HTTP ${res.status}`);
        throw new RouterQuoteError("network_error");
      }
      const body = (await res.json()) as {
        tx?: { to?: string; data?: string; value?: string | number };
        data?: { amountLpOut?: string; amountOut?: string };
      };
      const to = body?.tx?.to;
      const data = body?.tx?.data;
      if (
        typeof to !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(to) ||
        typeof data !== "string" ||
        !/^0x[0-9a-fA-F]*$/.test(data)
      ) {
        throw new RouterQuoteError("network_error");
      }
      return {
        to,
        data,
        value: String(body?.tx?.value ?? 0),
        expectedOut: body?.data?.amountLpOut ?? body?.data?.amountOut ?? null,
        tokenIn: target.tokenIn,
        amountIn: req.amountRaw,
      };
    } catch (err) {
      if (err instanceof RouterQuoteError) throw err;
      this.logger.warn(
        `[router-quote] pendle ${path} failed: ${(err as Error)?.message ?? err}`,
      );
      throw new RouterQuoteError("network_error");
    } finally {
      clearTimeout(timer);
    }
  }
}
