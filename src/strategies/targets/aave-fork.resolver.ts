/**
 * Family B — Aave-v3 forks (spec §5.3b, §1.5).
 *
 * SparkLend, Seamless, ZeroLend, Radiant and friends are Aave-v3 forks: the
 * same `Pool` exposing `supply(asset,amount,onBehalf,ref)` /
 * `withdraw(asset,amount,to)`, minting an aToken analog (`spToken`, `sToken`,
 * `rToken`). Only the Pool address differs, and the shipped `AaveV3` adapter
 * plus `validateAaveV3` already read it from the resolved target.
 *
 * So a fork ships as a **resolver only** — no new adapter, no new `kind`, no
 * branch. This file is the factory that makes one; adding the next fork is an
 * entry in the address-book plus a line at the bottom of this file.
 *
 * The Pool MUST be address-book-pinned rather than API-sourced (§11 Layer-1,
 * §12 Q7): the Pool is a singleton and its address is a `tx.to` for user funds.
 * A chain with no pinned Pool for the fork resolves to `null` → Manual.
 */

import { aaveForkPool } from "./address-book";
import type { Address, DepositTarget, PoolTargetResolver } from "./types";
import { resolveEvmChainId, underlyingOf } from "./types";

/**
 * Build a resolver for one Aave-v3 fork. `family` doubles as the
 * address-book key, so the Pool set and the resolver can't drift apart.
 */
export function aaveForkResolver(config: {
  family: string;
  aliases: readonly string[];
}): PoolTargetResolver {
  return {
    family: config.family,
    aliases: config.aliases,
    async resolve(pool, ctx): Promise<DepositTarget | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) return null;
      const poolAddr = aaveForkPool(config.family, chainId);
      if (!poolAddr) return null;
      const underlying = underlyingOf(pool);
      if (!underlying) return null;

      const target: DepositTarget = {
        kind: "aave-v3",
        pool: poolAddr,
        asset: underlying as Address,
      };
      // validateAaveV3 reads getReserveData(asset).aTokenAddress != 0, which
      // proves the reserve is actually listed on THIS Pool — the check that
      // makes a pinned-but-wrong Pool fail closed instead of reverting on-chain.
      return (await ctx.validate(target, pool)) ? target : null;
    },
  };
}

/**
 * SparkLend — the highest single-protocol unlock in the catalog for one file
 * (docs.spark.fi: same Pool ABI, `spToken`, Pool from its PoolAddressesProvider).
 * Note the savings products (`sUSDS`/`sDAI`) are a DIFFERENT Spark surface and
 * resolve through the Family-A pinned-vault resolver.
 */
export const SparkLendResolver = aaveForkResolver({
  family: "sparklend",
  aliases: ["spark", "sparklend", "spark-lend", "spark-protocol"],
});

export const SeamlessResolver = aaveForkResolver({
  family: "seamless",
  aliases: ["seamless-protocol", "seamless"],
});

export const ZeroLendResolver = aaveForkResolver({
  family: "zerolend",
  aliases: ["zerolend", "zerolend-rwa", "zerolend-linea"],
});

export const RadiantResolver = aaveForkResolver({
  family: "radiant",
  aliases: ["radiant-v2", "radiant", "radiant-capital"],
});

/**
 * Avalon has no single pinned Pool (one per BTC-LST market), so its book is
 * intentionally empty and this resolver always fails closed until a reviewed
 * per-market book lands. Registered anyway so the gap is visible in the
 * registry rather than looking like an unsupported protocol.
 */
export const AvalonResolver = aaveForkResolver({
  family: "avalon",
  aliases: ["avalon-finance", "avalon-lending", "avalon"],
});

export const TIER1_AAVE_FORK_RESOLVERS: readonly PoolTargetResolver[] = [
  SparkLendResolver,
  SeamlessResolver,
  ZeroLendResolver,
  RadiantResolver,
  AvalonResolver,
];
