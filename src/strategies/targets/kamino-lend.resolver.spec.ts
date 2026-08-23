/**
 * Kamino Lend resolver — the crux is the join: DeFiLlama's `pool` field is a
 * synthetic UUID (not the reserve address), so the resolver must recover the
 * reserve pubkey from Kamino's own API via (market name, mint).
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import {
  KAMINO_LEND_PROGRAM_ID,
  KaminoLendResolver,
} from "./kamino-lend.resolver";
import type { ResolverContext } from "./types";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const MARKET_ADDR = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const USDC_RESERVE = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
const SOL_RESERVE = "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q";

const MARKETS = [{ lendingMarket: MARKET_ADDR, name: "SOL/BTC Market" }];
const RESERVES = [
  {
    reserve: USDC_RESERVE,
    liquidityTokenMint: USDC,
    totalSupplyUsd: "1000000",
    totalBorrowUsd: "0",
  },
  {
    reserve: SOL_RESERVE,
    liquidityTokenMint: SOL,
    totalSupplyUsd: "500000",
    totalBorrowUsd: "0",
  },
];

function ctxWith(markets: unknown, reserves: unknown): ResolverContext {
  return {
    fetchJsonCached: jest.fn().mockImplementation((cacheKey: string) => {
      if (cacheKey.includes(":markets:")) return Promise.resolve(markets);
      return Promise.resolve(reserves);
    }),
    validate: jest.fn().mockResolvedValue(true),
  } as unknown as ResolverContext;
}

function solanaPool(
  overrides: Partial<DeFiLlamaYieldPool> = {},
): DeFiLlamaYieldPool {
  return {
    pool: "some-defillama-uuid",
    chain: "Solana",
    project: "kamino-lend",
    symbol: "USDC",
    tvlUsd: 1_000_000,
    apy: 5,
    ilRisk: "no",
    exposure: "single",
    poolMeta: "SOL/BTC Market",
    underlyingTokens: [USDC],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

describe("KaminoLendResolver", () => {
  it("resolves a pool to its reserve via the market-name + mint join", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool(),
      ctxWith(MARKETS, RESERVES),
    );
    expect(target).toEqual({
      kind: "solana-reserve",
      program: KAMINO_LEND_PROGRAM_ID,
      reserve: USDC_RESERVE,
      mint: USDC,
    });
  });

  it("matches market name case-insensitively", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool({ poolMeta: "sol/btc market" }),
      ctxWith(MARKETS, RESERVES),
    );
    expect(target).toEqual({
      kind: "solana-reserve",
      program: KAMINO_LEND_PROGRAM_ID,
      reserve: USDC_RESERVE,
      mint: USDC,
    });
  });

  it("resolves a different reserve in the same market by mint", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool({ symbol: "SOL", underlyingTokens: [SOL] }),
      ctxWith(MARKETS, RESERVES),
    );
    expect(target).toEqual({
      kind: "solana-reserve",
      program: KAMINO_LEND_PROGRAM_ID,
      reserve: SOL_RESERVE,
      mint: SOL,
    });
  });

  it("fails closed for a non-Solana chain", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool({ chain: "Ethereum" }),
      ctxWith(MARKETS, RESERVES),
    );
    expect(target).toBeNull();
  });

  it("fails closed for an unrelated project slug", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool({ project: "kamino-liquidity" }),
      ctxWith(MARKETS, RESERVES),
    );
    expect(target).toBeNull();
  });

  it("fails closed when no market matches poolMeta", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool({ poolMeta: "Some Unknown Market" }),
      ctxWith(MARKETS, RESERVES),
    );
    expect(target).toBeNull();
  });

  it("fails closed when no reserve in the market matches the mint", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool({
        underlyingTokens: ["SomeOtherMintNotListed1111111111111111111"],
      }),
      ctxWith(MARKETS, RESERVES),
    );
    expect(target).toBeNull();
  });

  it("disambiguates a dust reserve from the real one by re-deriving DeFiLlama's own tvlUsd formula", async () => {
    // Mirrors a real case found live 2026-08-23: Kamino's SOL/BTC Market
    // carries abandoned dust USDC reserves alongside the ~$5.3M live one.
    const dustReserve = {
      reserve: "DustUsdcReserve111111111111111111111111111",
      liquidityTokenMint: USDC,
      totalSupplyUsd: "0.1",
      totalBorrowUsd: "0",
    };
    const target = await KaminoLendResolver.resolve(
      solanaPool({ tvlUsd: 1_000_000 }),
      ctxWith(MARKETS, [...RESERVES, dustReserve]),
    );
    expect(target).toEqual({
      kind: "solana-reserve",
      program: KAMINO_LEND_PROGRAM_ID,
      reserve: USDC_RESERVE,
      mint: USDC,
    });
  });

  it("fails closed when two reserves are both plausibly the match (genuinely ambiguous)", async () => {
    // Neither candidate matches exactly, and both are equally far from the
    // pool's tvlUsd — a real coin flip, not a dust-vs-live case.
    const candidateA = {
      reserve: "CandidateAUsdcReserve11111111111111111111",
      liquidityTokenMint: USDC,
      totalSupplyUsd: "1100000",
      totalBorrowUsd: "0",
    };
    const candidateB = {
      reserve: "CandidateBUsdcReserve11111111111111111111",
      liquidityTokenMint: USDC,
      totalSupplyUsd: "900000",
      totalBorrowUsd: "0",
    };
    const target = await KaminoLendResolver.resolve(
      solanaPool({ tvlUsd: 1_000_000 }),
      ctxWith(MARKETS, [
        candidateA,
        candidateB,
        {
          reserve: SOL_RESERVE,
          liquidityTokenMint: SOL,
          totalSupplyUsd: "500000",
          totalBorrowUsd: "0",
        },
      ]),
    );
    expect(target).toBeNull();
  });

  it("fails closed when discovery is unreachable", async () => {
    const target = await KaminoLendResolver.resolve(
      solanaPool(),
      ctxWith(null, null),
    );
    expect(target).toBeNull();
  });
});
