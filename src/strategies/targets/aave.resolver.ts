/**
 * Aave v3 resolver (spec §3.1, §7.1).
 *
 * Aave is single-market-per-asset-per-chain, so there's nothing to
 * disambiguate — `(chain, underlyingTokens[0])` is already unique. The
 * resolver exists to emit a `{ kind: "aave-v3", pool, asset }` target so the
 * pool is AI-agent-executable in-app (badge "Deposit in-app") rather than
 * falling to the manual path. The Pool address is the canonical v3 Pool per
 * chain (address-book posture — one Pool per chain); the reserve is
 * `underlyingTokens[0]`. Validation (§3.2) confirms the reserve is listed.
 */

import { aaveForkPool } from "./address-book";
import type { Address, DepositTarget, PoolTargetResolver } from "./types";
import { resolveEvmChainId, underlyingOf } from "./types";

export const AaveResolver: PoolTargetResolver = {
  family: "aave",
  aliases: ["aave-v3", "aave", "aave-v2"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    // `AAVE_FORK_POOL_BOOKS.aave` — one address book, shared with
    // aave-fork.resolver.ts, so canonical Aave and its forks can never drift
    // out of sync the way this file's own hand-copied Pool map once did (it
    // was missing BSC entirely — see docs/runbooks/defi-manual-reasons-reference.md).
    const poolAddr = aaveForkPool("aave", chainId);
    if (!poolAddr) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;

    const target: DepositTarget = {
      kind: "aave-v3",
      pool: poolAddr,
      asset: underlying as Address,
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};
