import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { RaydiumAmmV4Resolver } from "./raydium-amm-v4.resolver";
import type { ResolverContext } from "./types";

const WSOL = "So11111111111111111111111111111111111111112";
const USELESS = "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk";
const AMM_V4_ID = "GxoRF3A1iMXhHTGvxAnT8b3Bk8Qqen41fmG5k2pT7K3Y";
const AMM_V4_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

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
        mintA: mintInfo(WSOL),
        mintB: mintInfo(USELESS),
        tvl: r.tvl,
        pooltype: r.pooltype ?? ["Amm", "OpenBookMarket"],
      })),
    },
  };
}

function pool(overrides: Partial<DeFiLlamaYieldPool> = {}): DeFiLlamaYieldPool {
  return {
    pool: "some-defillama-uuid",
    chain: "Solana",
    project: "raydium-amm",
    symbol: "WSOL-USELESS",
    tvlUsd: 22.81,
    apy: 5,
    ilRisk: "yes",
    exposure: "multi",
    poolMeta: "Standard - 0.25%",
    underlyingTokens: [WSOL, USELESS],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

function ctxWith(payload: unknown): ResolverContext {
  return {
    fetchJsonCached: async () => payload,
  } as unknown as ResolverContext;
}

describe("RaydiumAmmV4Resolver", () => {
  it("resolves the AMM v4 pool amid CPMM candidates (real WSOL/USELESS shape)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        {
          id: "Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp",
          programId: CPMM_PROGRAM,
          tvl: 2_286_105,
          pooltype: ["Cpmm"],
        },
        { id: AMM_V4_ID, programId: AMM_V4_PROGRAM, tvl: 22.81 },
      ]),
    );
    const target = await RaydiumAmmV4Resolver.resolve(pool(), ctx);
    expect(target).toEqual({
      kind: "raydium-amm-v4-pool",
      pool: AMM_V4_ID,
      mintA: WSOL,
      mintB: USELESS,
    });
  });

  it("fails closed for a StablePool AMM v4/v5 pool (different curve, not built)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        {
          id: AMM_V4_ID,
          programId: AMM_V4_PROGRAM,
          tvl: 22.81,
          pooltype: ["StablePool", "Stables"],
        },
      ]),
    );
    expect(await RaydiumAmmV4Resolver.resolve(pool(), ctx)).toBeNull();
  });

  it("fails closed for an Amm-tagged pool with no live OpenBook link", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        {
          id: AMM_V4_ID,
          programId: AMM_V4_PROGRAM,
          tvl: 22.81,
          pooltype: ["Amm"],
        },
      ]),
    );
    expect(await RaydiumAmmV4Resolver.resolve(pool(), ctx)).toBeNull();
  });

  it("fails closed for Concentrated poolMeta (CLMM, different program)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: AMM_V4_ID, programId: AMM_V4_PROGRAM, tvl: 22.81 },
      ]),
    );
    expect(
      await RaydiumAmmV4Resolver.resolve(
        pool({ poolMeta: "Concentrated - 0.01%" }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Solana chain", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: AMM_V4_ID, programId: AMM_V4_PROGRAM, tvl: 22.81 },
      ]),
    );
    expect(
      await RaydiumAmmV4Resolver.resolve(pool({ chain: "Ethereum" }), ctx),
    ).toBeNull();
  });

  it("fails closed when only a CPMM pool exists for the pair", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        {
          id: "Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp",
          programId: CPMM_PROGRAM,
          tvl: 2_286_105,
          pooltype: ["Cpmm"],
        },
      ]),
    );
    expect(await RaydiumAmmV4Resolver.resolve(pool(), ctx)).toBeNull();
  });

  it("fails closed when two AMM v4 candidates are genuinely ambiguous (equidistant TVL)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: AMM_V4_ID, programId: AMM_V4_PROGRAM, tvl: 100_000 },
        {
          id: "5dvUhE5LkHWFq4bhZRBTp1F4s216RcVFDmTKwAsVmLPL",
          programId: AMM_V4_PROGRAM,
          tvl: 300_000,
        },
      ]),
    );
    expect(
      await RaydiumAmmV4Resolver.resolve(pool({ tvlUsd: 200_000 }), ctx),
    ).toBeNull();
  });
});
