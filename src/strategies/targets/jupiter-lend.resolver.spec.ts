/**
 * Jupiter Lend Earn resolver — the `poolMeta === "Earn"` skip-guard is the
 * crux (the same slug also carries Borrow isolated-market rows), plus the
 * asset-match against the discovery source.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { JupiterLendResolver } from "./jupiter-lend.resolver";
import type { ResolverContext } from "./types";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const JLP = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";

const TOKENS = [{ assetAddress: USDC }, { assetAddress: WSOL }];

function ctxWith(tokens: unknown): ResolverContext {
  return {
    fetchJsonCached: jest.fn().mockResolvedValue(tokens),
    validate: jest.fn().mockResolvedValue(true),
  } as unknown as ResolverContext;
}

function solanaPool(
  overrides: Partial<DeFiLlamaYieldPool> = {},
): DeFiLlamaYieldPool {
  return {
    pool: "some-defillama-uuid",
    chain: "Solana",
    project: "jupiter-lend",
    symbol: "USDC",
    tvlUsd: 1_000_000,
    apy: 5,
    ilRisk: "no",
    exposure: "single",
    poolMeta: "Earn",
    underlyingTokens: [USDC],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

describe("JupiterLendResolver", () => {
  it("resolves an Earn-tagged pool to its jupiter-lend-vault target", async () => {
    const target = await JupiterLendResolver.resolve(
      solanaPool(),
      ctxWith(TOKENS),
    );
    expect(target).toEqual({ kind: "jupiter-lend-vault", asset: USDC });
  });

  it("refuses a Borrow isolated-market row sharing the same slug", async () => {
    // JLP/USDC — a real row from this exact project slug, poolMeta names the
    // paired market rather than "Earn".
    const target = await JupiterLendResolver.resolve(
      solanaPool({
        symbol: "JLP",
        poolMeta: "JLP/USDC",
        underlyingTokens: [JLP],
      }),
      ctxWith(TOKENS),
    );
    expect(target).toBeNull();
  });

  it("fails closed for a non-Solana chain", async () => {
    const target = await JupiterLendResolver.resolve(
      solanaPool({ chain: "Ethereum" }),
      ctxWith(TOKENS),
    );
    expect(target).toBeNull();
  });

  it("fails closed when the asset isn't in the discovery source", async () => {
    const target = await JupiterLendResolver.resolve(
      solanaPool({
        underlyingTokens: ["SomeOtherMintNotListed11111111111111111111"],
      }),
      ctxWith(TOKENS),
    );
    expect(target).toBeNull();
  });

  it("fails closed when discovery is unreachable", async () => {
    const target = await JupiterLendResolver.resolve(
      solanaPool(),
      ctxWith(null),
    );
    expect(target).toBeNull();
  });
});
