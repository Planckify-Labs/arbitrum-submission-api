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

import type { Address, DepositTarget, PoolTargetResolver } from "./types";
import { resolveEvmChainId, underlyingOf } from "./types";

// Canonical Aave v3 Pool per chain (aave-address-book). Most chains share the
// deterministic-deploy address; Ethereum L1 and Base differ.
const AAVE_V3_POOLS: Record<number, Address> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", // Ethereum
  10: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Optimism
  137: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Polygon
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Base
  42161: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Arbitrum
  43114: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Avalanche
};

export const AaveResolver: PoolTargetResolver = {
  family: "aave",
  aliases: ["aave-v3", "aave", "aave-v2"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    const poolAddr = AAVE_V3_POOLS[chainId];
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
