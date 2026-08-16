/**
 * Tier 3 — router-calldata families: Pendle and Uniswap LP (spec §6, §3.4).
 *
 * These protocols have **no stable on-chain deposit ABI we encode ourselves**.
 * Their hosted API returns the calldata, priced with slippage at request time.
 * That is a different trust model, so the target models **identity only** —
 * `(protocol, market, chainId, tokenIn)` — and the calldata is fetched at
 * execute time through OUR backend proxy, never from the device.
 *
 * The guardrails that make this safe live downstream and are all mandatory
 * (§6): the returned `to` must be on the pinned router allowlist, the quote's
 * slippage is capped server-side, the built call is simulated before signing,
 * and the decoded intent is asserted against what the user approved. This
 * resolver's job is only to say "this pool is a Pendle/Uniswap market we
 * recognise" — it never handles calldata.
 */

import { routerAllowlist } from "./address-book";
import { candidateAddressForPool } from "./candidates/registry";
import type { Address, DepositTarget, PoolTargetResolver } from "./types";
import { resolveEvmChainId, underlyingOf } from "./types";

type RouterProtocol = Extract<
  DepositTarget,
  { kind: "router-call" }
>["protocol"];

function routerCallResolver(config: {
  family: string;
  aliases: readonly string[];
  protocol: RouterProtocol;
  minTvlUsd?: number;
}): PoolTargetResolver {
  const minTvl = config.minTvlUsd ?? 0;
  return {
    family: config.family,
    aliases: config.aliases,
    async resolve(pool, ctx): Promise<DepositTarget | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) return null;
      // No pinned router for this (protocol, chain) ⇒ we could not verify the
      // API's `to` even if we fetched calldata. Refuse (§6 guardrail 2).
      if (routerAllowlist(config.protocol, chainId).length === 0) return null;

      const tokenIn = underlyingOf(pool);
      if (!tokenIn) return null;
      if (pool.tvlUsd < minTvl) return null;

      const market = await candidateAddressForPool(pool, ctx);
      if (!market) return null;

      const target: DepositTarget = {
        kind: "router-call",
        protocol: config.protocol,
        market,
        chainId,
        tokenIn: tokenIn as Address,
      };
      return (await ctx.validate(target, pool)) ? target : null;
    },
  };
}

/**
 * Pendle ships first (§6): add-liquidity is a single hosted-SDK call, versus
 * Uniswap's tick-range and impermanent-loss complexity.
 */
export const PendleResolver = routerCallResolver({
  family: "pendle",
  aliases: ["pendle", "pendle-lp", "pendle-pt", "pendle-yt"],
  protocol: "pendle",
  minTvlUsd: 250_000,
});

/**
 * Uniswap v3/v4 concentrated-liquidity LP. Registered behind its own sub-flag
 * so it can stay dark while Pendle proves the router-call path: a v3 LP
 * position needs a tick range, which is a materially different UX from "supply
 * this asset".
 */
export const UniswapV3Resolver = routerCallResolver({
  family: "uniswap-v3",
  aliases: ["uniswap-v3", "uniswap"],
  protocol: "uniswap-v3",
  minTvlUsd: 1_000_000,
});

export const UniswapV4Resolver = routerCallResolver({
  family: "uniswap-v4",
  aliases: ["uniswap-v4"],
  protocol: "uniswap-v4",
  minTvlUsd: 1_000_000,
});

export const TIER3_ROUTER_CALL_RESOLVERS: readonly PoolTargetResolver[] = [
  PendleResolver,
  UniswapV3Resolver,
  UniswapV4Resolver,
];
