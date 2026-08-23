import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { RaydiumStableResolver } from "./raydium-stable.resolver";
import type { ResolverContext } from "./types";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLE_ID = "2EXiumdi14E9b8Fy62QcA5Uh6WdHS2b38wtSxp72Mibj";
const STABLE_PROGRAM = "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h";
const AMM_V4_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

function mintInfo(address: string) {
  return { address };
}

/** Mirrors the real `/pools/info/mint` response shape, verified live 2026-08-23. */
function raydiumApiResponse(
  rows: Array<{
    id: string;
    programId: string;
    tvl: number;
    pooltype?: string[];
  }>,
) {
  return {
    data: {
      data: rows.map((r) => ({
        id: r.id,
        programId: r.programId,
        mintA: mintInfo(USDT),
        mintB: mintInfo(USDC),
        tvl: r.tvl,
        pooltype: r.pooltype ?? ["StablePool", "Stables"],
      })),
    },
  };
}

function pool(overrides: Partial<DeFiLlamaYieldPool> = {}): DeFiLlamaYieldPool {
  return {
    pool: "some-defillama-uuid",
    chain: "Solana",
    project: "raydium-amm",
    symbol: "USDT-USDC",
    tvlUsd: 404_346.05,
    apy: 3,
    ilRisk: "no",
    exposure: "multi",
    poolMeta: "Standard - 0.01%",
    underlyingTokens: [USDT, USDC],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

function ctxWith(payload: unknown): ResolverContext {
  return {
    fetchJsonCached: async () => payload,
  } as unknown as ResolverContext;
}

describe("RaydiumStableResolver", () => {
  it("resolves the StablePool amid AMM v4 candidates (real USDT/USDC shape)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        {
          id: "some-other-amm-v4-pool",
          programId: AMM_V4_PROGRAM,
          tvl: 62_258.56,
          pooltype: ["Amm", "OpenBookMarket", "Stables"],
        },
        { id: STABLE_ID, programId: STABLE_PROGRAM, tvl: 404_346.05 },
      ]),
    );
    const target = await RaydiumStableResolver.resolve(pool(), ctx);
    expect(target).toEqual({
      kind: "raydium-stable-pool",
      pool: STABLE_ID,
      mintA: USDT,
      mintB: USDC,
    });
  });

  it("fails closed when only an AMM v4 pool exists for the pair", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        {
          id: "some-other-amm-v4-pool",
          programId: AMM_V4_PROGRAM,
          tvl: 62_258.56,
          pooltype: ["Amm", "OpenBookMarket", "Stables"],
        },
      ]),
    );
    expect(await RaydiumStableResolver.resolve(pool(), ctx)).toBeNull();
  });

  it("fails closed for Concentrated poolMeta (CLMM, different program)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: STABLE_ID, programId: STABLE_PROGRAM, tvl: 404_346.05 },
      ]),
    );
    expect(
      await RaydiumStableResolver.resolve(
        pool({ poolMeta: "Concentrated - 0.01%" }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Solana chain", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: STABLE_ID, programId: STABLE_PROGRAM, tvl: 404_346.05 },
      ]),
    );
    expect(
      await RaydiumStableResolver.resolve(pool({ chain: "Ethereum" }), ctx),
    ).toBeNull();
  });

  it("fails closed when two StablePool candidates are genuinely ambiguous (equidistant TVL)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: STABLE_ID, programId: STABLE_PROGRAM, tvl: 100_000 },
        { id: "another-stable-pool", programId: STABLE_PROGRAM, tvl: 300_000 },
      ]),
    );
    expect(
      await RaydiumStableResolver.resolve(pool({ tvlUsd: 200_000 }), ctx),
    ).toBeNull();
  });
});
