import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { KaminoKvaultResolver } from "./kamino-kvault.resolver";

function sentoraPool(
  overrides: Partial<DeFiLlamaYieldPool> = {},
): DeFiLlamaYieldPool {
  return {
    pool: "77602b5c-3d34-5275-acbd-a18a69ccb206",
    chain: "Solana",
    project: "sentora",
    symbol: "PYUSD",
    tvlUsd: 114_352_610,
    apy: 5.96681,
    ilRisk: "no",
    exposure: "single",
    poolMeta: "Kamino Sentora PYUSD",
    underlyingTokens: ["2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

describe("KaminoKvaultResolver", () => {
  it("resolves the PYUSD Sentora vault", async () => {
    const target = await KaminoKvaultResolver.resolve(
      sentoraPool(),
      undefined as never,
    );
    expect(target).toEqual({
      kind: "kamino-kvault",
      vault: "A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK",
      mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    });
  });

  it("resolves the USDG Ethena vault", async () => {
    const target = await KaminoKvaultResolver.resolve(
      sentoraPool({
        symbol: "USDG",
        pool: "766869e4-47ca-5028-88ba-d59602cee166",
        tvlUsd: 788_842,
        poolMeta: "Kamino USDG Ethena",
        underlyingTokens: ["2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"],
      }),
      undefined as never,
    );
    expect(target).toEqual({
      kind: "kamino-kvault",
      vault: "D1XVxx4ur7kiSgpuerUmoJXvZ3yEBFZWPx1uN7qBADFb",
      mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    });
  });

  it("fails closed for the unrelated Ethereum sentora pool (same project, different chain)", async () => {
    expect(
      await KaminoKvaultResolver.resolve(
        sentoraPool({
          chain: "Ethereum",
          symbol: "USDC",
          poolMeta: "Sentora USD",
          underlyingTokens: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
        }),
        undefined as never,
      ),
    ).toBeNull();
  });

  it("fails closed for an unrecognized poolMeta on Solana", async () => {
    expect(
      await KaminoKvaultResolver.resolve(
        sentoraPool({ poolMeta: "Some Future Sentora Vault" }),
        undefined as never,
      ),
    ).toBeNull();
  });

  it("fails closed when the underlying mint doesn't match the pinned venue", async () => {
    expect(
      await KaminoKvaultResolver.resolve(
        sentoraPool({ underlyingTokens: ["11111111111111111111111111111111"] }),
        undefined as never,
      ),
    ).toBeNull();
  });
});
