/**
 * Solana liquid-staking resolver — mirrors `sui-resolvers.spec.ts`'s
 * `SuiLstResolver` block. No RPC/HTTP dependency, so no mocking is needed:
 * the resolver is a pure match against the pinned venue table.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { SolanaLstResolver } from "./solana-lst.resolver";

function solanaPool(
  overrides: Partial<DeFiLlamaYieldPool> = {},
): DeFiLlamaYieldPool {
  return {
    pool: "some-defillama-uuid",
    chain: "Solana",
    project: "jito-liquid-staking",
    symbol: "JITOSOL",
    tvlUsd: 1_000_000,
    apy: 7,
    ilRisk: "no",
    exposure: "single",
    poolMeta: null,
    underlyingTokens: ["So11111111111111111111111111111111111111112"],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

describe("SolanaLstResolver", () => {
  it("resolves each venue's real DeFiLlama pool to its solana-lst-stake target", async () => {
    const cases: Array<[string, string, string]> = [
      [
        "jito-liquid-staking",
        "jito",
        "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
      ],
      [
        "jupiter-staked-sol",
        "jupsol",
        "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
      ],
      [
        "drift-staked-sol",
        "dsol",
        "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ",
      ],
      [
        "marinade-liquid-staking",
        "marinade",
        "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
      ],
    ];
    for (const [project, venue, poolMint] of cases) {
      const target = await SolanaLstResolver.resolve(
        solanaPool({ project }),
        undefined as never,
      );
      expect(target).toEqual({ kind: "solana-lst-stake", venue, poolMint });
    }
  });

  it("fails closed for an unknown (non-LST) project", async () => {
    expect(
      await SolanaLstResolver.resolve(
        solanaPool({ project: "not-an-lst" }),
        undefined as never,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Solana chain", async () => {
    expect(
      await SolanaLstResolver.resolve(
        solanaPool({ project: "jito-liquid-staking", chain: "Ethereum" }),
        undefined as never,
      ),
    ).toBeNull();
  });
});
