/**
 * The cache contract and the coverage table.
 *
 * These lock in the two behaviours that keep a 1k/day quota survivable:
 *   - a default (non-refresh) read never touches Zerion when a cache entry
 *     exists, and therefore never increments the budget counter;
 *   - an unsupported (chain, capability) pair makes ZERO upstream calls.
 * Plus the 202 fix: `response.ok` is true for 202, so a still-indexing wallet
 * must not be parsed as final data, and must not be cached.
 */

import { ZerionClient } from "./zerion.client";
import { resolveZerionChainIds } from "./zerion.chains";

const fakeConfig = {
  get: (name: string) =>
    name === "ZERION_API_KEY"
      ? "test-key"
      : name === "ZERION_API_URL"
        ? "https://api.zerion.io/v1"
        : undefined,
};

/** In-memory Valkey double, so cache reads/writes actually round-trip. */
function fakeValkey() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return true;
    }),
  };
}

function makeClient(valkey: ReturnType<typeof fakeValkey>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ZerionClient(fakeConfig as any, valkey as any);
}

const ASSET_ROW = {
  attributes: {
    position_type: "wallet",
    quantity: { int: "1000000", decimals: 6, float: 1 },
    value: 1,
    fungible_info: {
      name: "USD Coin",
      symbol: "USDC",
      icon: { url: "https://cdn.zerion.io/usdc.png" },
      flags: { verified: true },
      implementations: [
        { chain_id: "base", address: "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913", decimals: 6 },
      ],
    },
  },
  relationships: { chain: { data: { id: "base" } } },
};

function okFetch(body: unknown) {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe("chain coverage table", () => {
  it("keeps solana for token discovery but drops it for defi and nft", () => {
    expect(resolveZerionChainIds(["solana"], "tokens")).toEqual(["solana"]);
    expect(resolveZerionChainIds(["solana"], "defi")).toEqual([]);
    expect(resolveZerionChainIds(["solana"], "nft")).toEqual([]);
  });

  it("drops chains Zerion does not support at all", () => {
    // Sui and Stellar are absent from Zerion entirely.
    expect(resolveZerionChainIds(["sui", "stellar"], "tokens")).toEqual([]);
  });

  it("accepts numeric chain ids as numbers or CSV strings", () => {
    expect(resolveZerionChainIds([8453], "tokens")).toEqual(["base"]);
    expect(resolveZerionChainIds(["8453"], "tokens")).toEqual(["base"]);
  });
});

describe("unsupported chains cost nothing", () => {
  it("makes zero fetch calls when every requested chain is unsupported", async () => {
    const fetchMock = okFetch({ data: [] });
    global.fetch = fetchMock;
    const valkey = fakeValkey();
    const client = makeClient(valkey);

    const result = await client.discoverAssets("0xwallet", { chains: ["sui"] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ready", data: [] });
  });

  it("does not ask Zerion for solana DeFi positions", async () => {
    const fetchMock = okFetch({ data: [] });
    global.fetch = fetchMock;
    const client = makeClient(fakeValkey());

    await client.getDefiPositions("0xwallet", { chains: ["solana"] });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cached by default, fresh on refresh", () => {
  it("serves the cache on a second default read, without spending budget", async () => {
    const fetchMock = okFetch({ data: [ASSET_ROW] });
    global.fetch = fetchMock;
    const valkey = fakeValkey();
    const client = makeClient(valkey);

    const first = await client.discoverAssets("0xwallet", { chains: [8453] });
    expect(first.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const budgetKey = [...valkey.store.keys()].find((k) =>
      k.startsWith("zerion:ratelimit:"),
    ) as string;
    const budgetAfterFirst = valkey.store.get(budgetKey);

    const second = await client.discoverAssets("0xwallet", { chains: [8453] });

    expect(second.fromCache).toBe(true);
    expect(second.data).toEqual(first.data);
    // The whole point: a cache hit is free.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(valkey.store.get(budgetKey)).toBe(budgetAfterFirst);
  });

  it("refresh=true bypasses the cache and does spend budget", async () => {
    const fetchMock = okFetch({ data: [ASSET_ROW] });
    global.fetch = fetchMock;
    const valkey = fakeValkey();
    const client = makeClient(valkey);

    await client.discoverAssets("0xwallet", { chains: [8453] });
    const fresh = await client.discoverAssets("0xwallet", {
      chains: [8453],
      refresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fresh.fromCache).toBe(false);
    expect(fresh.throttled).toBeUndefined();
  });

  it("serves cached data with `throttled` when refreshes come too fast", async () => {
    const fetchMock = okFetch({ data: [ASSET_ROW] });
    global.fetch = fetchMock;
    const client = makeClient(fakeValkey());

    await client.discoverAssets("0xwallet", { chains: [8453] });
    await client.discoverAssets("0xwallet", { chains: [8453], refresh: true });
    // Second refresh inside the throttle window.
    const throttled = await client.discoverAssets("0xwallet", {
      chains: [8453],
      refresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(throttled.throttled).toBe(true);
    // Degrades to data, not to an error — the screen still shows something.
    expect(throttled.data).toHaveLength(1);
  });
});

describe("202 Accepted (wallet still indexing)", () => {
  it("reports indexing instead of parsing the body, and does not cache it", async () => {
    const json = jest.fn(async () => ({ data: [ASSET_ROW] }));
    global.fetch = jest.fn(async () => ({
      ok: true, // `response.ok` is TRUE for 202 — this is the trap being fixed
      status: 202,
      statusText: "Accepted",
      json,
    })) as unknown as typeof fetch;
    const valkey = fakeValkey();
    const client = makeClient(valkey);

    const result = await client.discoverAssets("0xwallet", { chains: [8453] });

    expect(result.status).toBe("indexing");
    expect(result.data).toEqual([]);
    expect(json).not.toHaveBeenCalled();
    expect([...valkey.store.keys()].some((k) => k.startsWith("zerion:discovery:"))).toBe(
      false,
    );
  });
});

describe("discovery projects identity only", () => {
  it("emits no quantity or value, and keeps a missing icon null", async () => {
    const rowWithoutIcon = {
      ...ASSET_ROW,
      attributes: {
        ...ASSET_ROW.attributes,
        fungible_info: {
          ...ASSET_ROW.attributes.fungible_info,
          icon: { url: null },
          flags: { verified: false },
        },
      },
    };
    global.fetch = okFetch({ data: [ASSET_ROW, rowWithoutIcon] });
    const client = makeClient(fakeValkey());

    const { data } = await client.discoverAssets("0xwallet", { chains: [8453] });

    // Both rows are the same asset — identity dedupes them to one.
    expect(data).toHaveLength(1);
    const [asset] = data;
    expect(asset).toEqual({
      namespace: "eip155",
      chainId: 8453,
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      logoUrl: "https://cdn.zerion.io/usdc.png",
      verified: true,
    });
    // Balances are read on-chain; a third party's number must never leak in.
    expect(asset).not.toHaveProperty("quantity");
    expect(asset).not.toHaveProperty("value");
  });

  it("maps a null icon url to null rather than the string 'null'", async () => {
    global.fetch = okFetch({
      data: [
        {
          ...ASSET_ROW,
          attributes: {
            ...ASSET_ROW.attributes,
            fungible_info: {
              ...ASSET_ROW.attributes.fungible_info,
              icon: null,
            },
          },
        },
      ],
    });
    const client = makeClient(fakeValkey());

    const { data } = await client.discoverAssets("0xwallet", { chains: [8453] });

    expect(data[0].logoUrl).toBeNull();
  });
});
