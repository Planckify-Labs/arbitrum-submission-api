import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { RaydiumCpmmResolver } from "./raydium-cpmm.resolver";
import type { ResolverContext } from "./types";

const WSOL = "So11111111111111111111111111111111111111112";
const USELESS = "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk";
const CPMM_ID = "Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp";
const CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const AMM_V4_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

function mintInfo(address: string) {
  return { address };
}

/** Mirrors the real `/pools/info/mint` response shape, verified live 2026-08-23. */
function raydiumApiResponse(
  rows: Array<{ id: string; programId: string; tvl: number }>,
) {
  return {
    data: {
      data: rows.map((r) => ({
        id: r.id,
        programId: r.programId,
        mintA: mintInfo(WSOL),
        mintB: mintInfo(USELESS),
        tvl: r.tvl,
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
    tvlUsd: 2_286_105,
    apy: 40,
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

describe("RaydiumCpmmResolver", () => {
  it("resolves the CPMM pool amid AMM-v4 + dust CPMM candidates (real WSOL/USELESS shape)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: CPMM_ID, programId: CPMM_PROGRAM, tvl: 2_286_105 },
        {
          id: "GxoRF3A1iMXhHTGvxAnT8b3Bk8Qqen41fmG5k2pT7K3Y",
          programId: AMM_V4_PROGRAM,
          tvl: 22.81,
        },
        {
          id: "5QM3EFuKMPq3XPehgv7FzHYxvd2ecWcYDqMDTVk8VJ9Q",
          programId: CPMM_PROGRAM,
          tvl: 0.9,
        },
        {
          id: "5dvUhE5LkHWFq4bhZRBTp1F4s216RcVFDmTKwAsVmLPL",
          programId: CPMM_PROGRAM,
          tvl: 0.01,
        },
      ]),
    );
    const target = await RaydiumCpmmResolver.resolve(pool(), ctx);
    expect(target).toEqual({
      kind: "raydium-cpmm-pool",
      pool: CPMM_ID,
      mintA: WSOL,
      mintB: USELESS,
    });
  });

  it("resolves cleanly when only one CPMM pool exists for the pair", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: CPMM_ID, programId: CPMM_PROGRAM, tvl: 500_000 },
      ]),
    );
    const target = await RaydiumCpmmResolver.resolve(
      pool({ tvlUsd: 500_000 }),
      ctx,
    );
    expect(target).toEqual({
      kind: "raydium-cpmm-pool",
      pool: CPMM_ID,
      mintA: WSOL,
      mintB: USELESS,
    });
  });

  it("fails closed when only an AMM-v4 pool exists for the pair (not built yet)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        {
          id: "GxoRF3A1iMXhHTGvxAnT8b3Bk8Qqen41fmG5k2pT7K3Y",
          programId: AMM_V4_PROGRAM,
          tvl: 22.81,
        },
      ]),
    );
    expect(await RaydiumCpmmResolver.resolve(pool(), ctx)).toBeNull();
  });

  it("fails closed for Concentrated poolMeta (CLMM, different program)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: CPMM_ID, programId: CPMM_PROGRAM, tvl: 2_286_105 },
      ]),
    );
    expect(
      await RaydiumCpmmResolver.resolve(
        pool({ poolMeta: "Concentrated - 0.01%" }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Solana chain", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: CPMM_ID, programId: CPMM_PROGRAM, tvl: 2_286_105 },
      ]),
    );
    expect(
      await RaydiumCpmmResolver.resolve(pool({ chain: "Ethereum" }), ctx),
    ).toBeNull();
  });

  it("fails closed for an unrelated project", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: CPMM_ID, programId: CPMM_PROGRAM, tvl: 2_286_105 },
      ]),
    );
    expect(
      await RaydiumCpmmResolver.resolve(pool({ project: "orca-dex" }), ctx),
    ).toBeNull();
  });

  it("fails closed when two CPMM candidates are genuinely ambiguous (equidistant TVL)", async () => {
    const ctx = ctxWith(
      raydiumApiResponse([
        { id: CPMM_ID, programId: CPMM_PROGRAM, tvl: 100_000 },
        {
          id: "5QM3EFuKMPq3XPehgv7FzHYxvd2ecWcYDqMDTVk8VJ9Q",
          programId: CPMM_PROGRAM,
          tvl: 300_000,
        },
      ]),
    );
    // pool.tvlUsd = 200_000 is exactly equidistant (100_000 away) from both.
    expect(
      await RaydiumCpmmResolver.resolve(pool({ tvlUsd: 200_000 }), ctx),
    ).toBeNull();
  });

  it("fails closed when the API returns nothing for the pair", async () => {
    const ctx = ctxWith(raydiumApiResponse([]));
    expect(await RaydiumCpmmResolver.resolve(pool(), ctx)).toBeNull();
  });
});
