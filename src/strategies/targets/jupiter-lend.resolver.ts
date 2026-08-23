/**
 * Jupiter Lend Earn resolver — mirrors the `erc4626` family shape (single
 * kind, dispatched by underlying asset) rather than a per-market resolver.
 *
 * `jupiter-lend` on DeFiLlama mixes TWO products under one project slug:
 * the single-asset Earn vaults (what this resolver targets) AND Borrow
 * isolated-market rows (JLP/USDC, WSOL/USDC, JupSOL/WSOL, …) whose
 * `underlyingTokens` is the market's borrowed/collateral asset, not an Earn
 * deposit — the exact "borrow-side row shares a slug" trap already
 * documented for Curve LlamaLend and Sky's ilk rows. DeFiLlama's own
 * `poolMeta` cleanly distinguishes them: Earn rows are tagged exactly
 * `"Earn"`; every Borrow row is tagged `"<symbol>/<pairedAsset>"` (verified
 * live 2026-08-23 — 7 "Earn" rows, one per live vault, vs. 72 paired rows).
 * `skipPool` refuses anything not tagged `"Earn"` before a candidate is
 * even requested, per the runbook's rule for exactly this shape of pool.
 *
 * Discovery is the protocol's own public HTTPS endpoint
 * (`lite-api.jup.ag/lend/v1/earn/tokens`, TTL-cached) — NOT the npm SDK,
 * which the resolver has no need for: it only needs `assetAddress` per
 * vault to match `pool.underlyingTokens[0]`. The npm SDK's PDA-derivation
 * logic is what the MOBILE adapter needs (see
 * `services/defi/adapters/jupiterLend.ts`'s header for why it can't be
 * hand-rolled instead).
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const TOKENS_API = "https://lite-api.jup.ag/lend/v1/earn/tokens";
const TOKENS_TTL_SEC = 300;

interface JupiterLendToken {
  assetAddress: string;
}

export const JupiterLendResolver: PoolTargetResolver = {
  family: "jupiter-lend",
  aliases: ["jupiter-lend"],
  async resolve(
    pool: DeFiLlamaYieldPool,
    ctx: ResolverContext,
  ): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    // Refuse Borrow-market rows before requesting a candidate (see header).
    if (pool.poolMeta !== "Earn") return null;
    const underlying = pool.underlyingTokens?.[0];
    if (!underlying) return null;

    const tokens = await ctx.fetchJsonCached<JupiterLendToken[]>(
      "defillama:targets:jupiter-lend:tokens:v1",
      TOKENS_API,
      TOKENS_TTL_SEC,
    );
    if (!tokens) return null;
    const match = tokens.find(
      (t) => t.assetAddress.toLowerCase() === underlying.toLowerCase(),
    );
    if (!match) return null;
    return { kind: "jupiter-lend-vault", asset: match.assetAddress };
  },
};
