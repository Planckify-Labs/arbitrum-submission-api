/**
 * ZerionClient.getPositions — fixtures below are trimmed from a REAL
 * response captured 2026-08-16 against the live `GET
 * /v1/wallets/{addr}/positions/` endpoint (verified with a real API key,
 * two different wallets). Not hand-guessed field names.
 *
 * The key behavior this locks in: a `"wallet"`-type row (a plain token
 * balance Zerion hasn't classified as a protocol position — this is
 * EXACTLY what a real Compound III `cUSDTv3` balance came back as) must be
 * filtered out, while `"deposit"`/`"staked"` rows are normalized.
 */

import { ZerionClient } from "./zerion.client";

function fakeValkey() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
  };
}

const fakeConfig = {
  get: (name: string) =>
    name === "ZERION_API_KEY"
      ? "test-key"
      : name === "ZERION_API_URL"
        ? "https://api.zerion.io/v1"
        : undefined,
};

function makeClient(valkey: ReturnType<typeof fakeValkey>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ZerionClient(fakeConfig as any, valkey as any);
}

afterEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

/** Real "wallet"-type row: a Compound III cUSDTv3 balance, unclassified by
 *  Zerion (no protocol tag, no value) — captured live 2026-08-16. */
const REAL_WALLET_TYPE_ROW = {
  type: "positions",
  id: "arbitrum-ctoken-asset",
  attributes: {
    parent: null,
    protocol: null,
    name: "Asset",
    position_type: "wallet",
    quantity: { int: "12905547", decimals: 6, float: 12.905547, numeric: "12.905547" },
    value: null,
    price: null,
    fungible_info: {
      name: "cUSDTv3",
      symbol: "cUSDTv3",
      implementations: [{ chain_id: "arbitrum", address: "0xd98be00b5d27fc98112bde293e487f8d4ca57d9" }],
    },
  },
  relationships: {
    chain: { data: { type: "chains", id: "arbitrum" } },
  },
};

/** Real "deposit"-type row (Yearn V3 USDC vault) — captured live 2026-08-16. */
const REAL_DEPOSIT_TYPE_ROW = {
  type: "positions",
  id: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913-base-yearn v3 yield: usdc pool-deposit",
  attributes: {
    parent: null,
    protocol: "Yearn V3",
    protocol_module: "yield",
    pool_address: "0xb13cf163d916917d9cd6e836905ca5f12a1def4b",
    name: "Yearn V3 Yield: USDC Pool",
    position_type: "deposit",
    quantity: { int: "914281587", decimals: 6, float: 914.281587, numeric: "914.281587" },
    value: 914.0474654511663,
    price: 0.9997439284,
    fungible_info: {
      name: "USDC",
      symbol: "USDC",
      implementations: [
        { chain_id: "base", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
        { chain_id: "arbitrum", address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
      ],
    },
  },
  relationships: {
    chain: { data: { type: "chains", id: "base" } },
    dapp: { data: { type: "dapps", id: "yearn-v3" } },
  },
};

describe("ZerionClient.getPositions", () => {
  it("filters out wallet-type rows (the exact shape a real Compound III cUSDTv3 balance came back as)", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: [REAL_WALLET_TYPE_ROW] }),
    })) as unknown as typeof fetch;

    const client = makeClient(fakeValkey());
    const positions = await client.getPositions("0xwallet");

    expect(positions).toEqual([]);
  });

  it("normalizes a real deposit-type row: dapp id, pool address, per-chain asset contract", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: [REAL_DEPOSIT_TYPE_ROW] }),
    })) as unknown as typeof fetch;

    const client = makeClient(fakeValkey());
    const [position] = await client.getPositions("0xwallet");

    expect(position).toEqual({
      dappId: "yearn-v3",
      protocolName: "Yearn V3",
      poolAddress: "0xb13cf163d916917d9cd6e836905ca5f12a1def4b",
      zerionChainId: "base",
      assetSymbol: "USDC",
      // Picks the implementation matching THIS row's own chain (base), not
      // the arbitrum one also present in fungible_info.implementations.
      assetContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      quantityRaw: "914281587",
      decimals: 6,
      valueUsd: 914.0474654511663,
      // Widened normalizer: the raw position_type is carried through instead
      // of being flattened away, so borrowed/locked/reward rows can reach the
      // UI while reconciliation keeps filtering down to deposit/staked.
      status: "deposit",
      chainId: 8453,
      logoUrl: null,
    });
  });

  it("degrades to [] (never throws) when the request fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const client = makeClient(fakeValkey());
    const positions = await client.getPositions("0xwallet");

    expect(positions).toEqual([]);
  });
});
