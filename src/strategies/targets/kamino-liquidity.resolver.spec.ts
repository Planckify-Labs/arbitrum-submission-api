/**
 * Kamino kliquidity resolver — the crux is the join: DeFiLlama's
 * `kamino-liquidity` rows carry no `poolMeta` at all, so the resolver must
 * recover the strategy address from the mint pair alone, then disambiguate
 * by nearest match to the pool's own `tvlUsd` when more than one live
 * strategy shares that pair.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import {
  KAMINO_LIQUIDITY_PROGRAM_ID,
  KaminoLiquidityResolver,
} from "./kamino-liquidity.resolver";
import type { ResolverContext } from "./types";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYUSD = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const SOL = "So11111111111111111111111111111111111111112";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

const STRATEGY_A = "Hmj82e48X9LNW8LeMLk186iE4UKPoUwWuLwoiqMpUiGm";
const STRATEGY_B = "9WoAUZfnvEg5CjucFtqRk7QSSAK4RfSFRVJvLpxxbXK1";

const STRATEGIES = [
  { address: STRATEGY_A, status: "LIVE", tokenAMint: PYUSD, tokenBMint: USDC },
  { address: STRATEGY_B, status: "LIVE", tokenAMint: SOL, tokenBMint: JITOSOL },
  // A non-LIVE strategy sharing PYUSD/USDC must never be picked.
  {
    address: "IgnoredStrategy1111111111111111111111111",
    status: "IGNORED",
    tokenAMint: PYUSD,
    tokenBMint: USDC,
  },
];

function ctxWith(strategies: unknown, metrics: unknown): ResolverContext {
  return {
    fetchJsonCached: jest.fn().mockImplementation((cacheKey: string) => {
      if (cacheKey.includes(":strategies:")) return Promise.resolve(strategies);
      return Promise.resolve(metrics);
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
    project: "kamino-liquidity",
    symbol: "PYUSD-USDC",
    tvlUsd: 18_000_000,
    apy: 4,
    ilRisk: "yes",
    exposure: "multi",
    poolMeta: null,
    underlyingTokens: [PYUSD, USDC],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

describe("KaminoLiquidityResolver", () => {
  it("resolves a pool to its strategy via the mint-pair join", async () => {
    const metrics = [{ strategy: STRATEGY_A, totalValueLocked: "18332388" }];
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool(),
      ctxWith(STRATEGIES, metrics),
    );
    expect(target).toEqual({
      kind: "kamino-liquidity-strategy",
      strategy: STRATEGY_A,
      mintA: PYUSD,
      mintB: USDC,
    });
  });

  it("matches the mint pair order-insensitively", async () => {
    const metrics = [{ strategy: STRATEGY_A, totalValueLocked: "18332388" }];
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({ underlyingTokens: [USDC, PYUSD] }),
      ctxWith(STRATEGIES, metrics),
    );
    expect(target).toEqual({
      kind: "kamino-liquidity-strategy",
      strategy: STRATEGY_A,
      mintA: PYUSD,
      mintB: USDC,
    });
  });

  it("resolves a different strategy on a different pair", async () => {
    const metrics = [{ strategy: STRATEGY_B, totalValueLocked: "7524356" }];
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({
        symbol: "SOL-JITOSOL",
        tvlUsd: 7_524_356,
        underlyingTokens: [SOL, JITOSOL],
      }),
      ctxWith(STRATEGIES, metrics),
    );
    expect(target).toEqual({
      kind: "kamino-liquidity-strategy",
      strategy: STRATEGY_B,
      mintA: SOL,
      mintB: JITOSOL,
    });
  });

  it("never matches a non-LIVE strategy", async () => {
    // Only the IGNORED strategy shares this exact pair in this fixture set
    // once STRATEGY_A is removed, so a naive "any status" join would
    // wrongly pick it.
    const onlyIgnored = STRATEGIES.filter((s) => s.address !== STRATEGY_A);
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool(),
      ctxWith(onlyIgnored, []),
    );
    expect(target).toBeNull();
  });

  it("fails closed for a non-Solana chain", async () => {
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({ chain: "Ethereum" }),
      ctxWith(STRATEGIES, []),
    );
    expect(target).toBeNull();
  });

  it("fails closed for an unrelated project slug", async () => {
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({ project: "kamino-lend" }),
      ctxWith(STRATEGIES, []),
    );
    expect(target).toBeNull();
  });

  it("fails closed when no live strategy shares the mint pair", async () => {
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({
        underlyingTokens: [
          "UnknownMintAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "UnknownMintBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ],
      }),
      ctxWith(STRATEGIES, []),
    );
    expect(target).toBeNull();
  });

  it("disambiguates two strategies on the same pair by nearest TVL match", async () => {
    const dup = {
      address: STRATEGY_B,
      status: "LIVE",
      tokenAMint: PYUSD,
      tokenBMint: USDC,
    };
    const metrics = [
      { strategy: STRATEGY_A, totalValueLocked: "18000000" },
      { strategy: STRATEGY_B, totalValueLocked: "500000" },
    ];
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({ tvlUsd: 18_100_000 }),
      ctxWith([...STRATEGIES, dup], metrics),
    );
    expect(target).toEqual({
      kind: "kamino-liquidity-strategy",
      strategy: STRATEGY_A,
      mintA: PYUSD,
      mintB: USDC,
    });
  });

  it("fails closed when two strategies on the same pair are both plausibly the match", async () => {
    const dup = {
      address: STRATEGY_B,
      status: "LIVE",
      tokenAMint: PYUSD,
      tokenBMint: USDC,
    };
    const metrics = [
      { strategy: STRATEGY_A, totalValueLocked: "9_100_000".replace(/_/g, "") },
      { strategy: STRATEGY_B, totalValueLocked: "8900000" },
    ];
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({ tvlUsd: 9_000_000 }),
      ctxWith([...STRATEGIES, dup], metrics),
    );
    expect(target).toBeNull();
  });

  it("fails closed when the best match is more than 15% off the pool's tvlUsd", async () => {
    const metrics = [{ strategy: STRATEGY_A, totalValueLocked: "1000" }];
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool({ tvlUsd: 18_000_000 }),
      ctxWith(STRATEGIES, metrics),
    );
    expect(target).toBeNull();
  });

  it("fails closed when discovery is unreachable", async () => {
    const target = await KaminoLiquidityResolver.resolve(
      solanaPool(),
      ctxWith(null, null),
    );
    expect(target).toBeNull();
  });

  it("exposes the verified kliquidity program id", () => {
    expect(KAMINO_LIQUIDITY_PROGRAM_ID).toBe(
      "6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc",
    );
  });
});
