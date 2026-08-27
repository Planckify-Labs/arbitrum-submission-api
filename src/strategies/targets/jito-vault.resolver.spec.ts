import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { JitoVaultResolver } from "./jito-vault.resolver";

function kyrosPool(
  overrides: Partial<DeFiLlamaYieldPool> = {},
): DeFiLlamaYieldPool {
  return {
    pool: "28d991e9-dcd9-4fcd-a29e-0fa98a296c5e",
    chain: "Solana",
    project: "kyros",
    symbol: "KYSOL",
    tvlUsd: 10_800_000,
    apy: 5.43,
    ilRisk: "no",
    exposure: "single",
    underlyingTokens: ["J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

describe("JitoVaultResolver", () => {
  it("resolves the kySOL vault", async () => {
    const target = await JitoVaultResolver.resolve(
      kyrosPool(),
      undefined as never,
    );
    expect(target).toEqual({
      kind: "jito-vault-deposit",
      vault: "CQpvXgoaaawDCLh8FwMZEwQqnPakRUZ5BnzhjnEBPJv",
      mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    });
  });

  it("fails closed for a non-Solana chain", async () => {
    expect(
      await JitoVaultResolver.resolve(
        kyrosPool({ chain: "Ethereum" }),
        undefined as never,
      ),
    ).toBeNull();
  });

  it("fails closed when the underlying mint doesn't match JitoSOL", async () => {
    expect(
      await JitoVaultResolver.resolve(
        kyrosPool({ underlyingTokens: ["11111111111111111111111111111111"] }),
        undefined as never,
      ),
    ).toBeNull();
  });
});
