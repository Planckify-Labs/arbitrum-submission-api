/**
 * AlchemyPricesClient — the USD spot-price source for DeFi position
 * valuation (docs/defi-evm-protocol-expansion-spec.md §9). Covers: chain-id
 * -> Alchemy network mapping, cache round-tripping through the *real*
 * ValkeyService JSON-encode/decode behavior (a bare string sentinel like
 * `"null"` would silently misbehave there — `JSON.parse("null")` returns
 * the value `null`, which reads back as a cache MISS), and graceful
 * degradation to `null` on a missing key / failed request.
 */

import {
  AlchemyPricesClient,
  alchemyNetworkForChainId,
} from "./alchemy-prices.client";

/**
 * Fake ValkeyService with an in-memory store that round-trips exactly like
 * the real one: `set` JSON.stringifies objects, `get` JSON.parses on read
 * (falling back to the raw string only if that throws). Mirrors the helper
 * in `sui-lst.source.spec.ts`.
 */
function fakeValkey(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return {
    store,
    get: jest.fn(async (key: string) => {
      const s = store.get(key);
      if (s == null) return null;
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    }),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
      return true;
    }),
  };
}

const fakeConfigWithKey = {
  get: (name: string) =>
    name === "ALCHEMY_PRICES_API_KEY" ? "test-key" : undefined,
};
const fakeConfigNoKey = { get: () => undefined };

function makeClient(
  valkey: ReturnType<typeof fakeValkey>,
  config: { get: (name: string) => string | undefined } = fakeConfigWithKey,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AlchemyPricesClient(config as any, valkey as any);
}

afterEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe("alchemyNetworkForChainId", () => {
  it("maps known EVM chain ids to Alchemy's network slugs", () => {
    expect(alchemyNetworkForChainId(1)).toBe("eth-mainnet");
    expect(alchemyNetworkForChainId(8453)).toBe("base-mainnet");
    expect(alchemyNetworkForChainId(42161)).toBe("arb-mainnet");
  });

  it("returns null for an unmapped chain id", () => {
    expect(alchemyNetworkForChainId(999999)).toBeNull();
  });
});

describe("AlchemyPricesClient.getPricesByAddress", () => {
  it("fetches, prices, and caches a fresh address", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            network: "eth-mainnet",
            address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606EB48",
            prices: [{ currency: "USD", value: "1.00", lastUpdatedAt: "" }],
            error: null,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const valkey = fakeValkey();
    const client = makeClient(valkey);
    const result = await client.getPricesByAddress([
      {
        network: "eth-mainnet",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606EB48",
      },
    ]);

    expect(result.get("eth-mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toBe(
      1,
    );
    expect(valkey.set).toHaveBeenCalledWith(
      "alchemy-prices:addr:eth-mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      { usd: 1 },
      { ttl: 60 },
    );
  });

  it("serves a cached price without calling fetch again", async () => {
    const key =
      "alchemy-prices:addr:eth-mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const valkey = fakeValkey({ [key]: { usd: 2.5 } });
    global.fetch = jest.fn() as unknown as typeof fetch;

    const client = makeClient(valkey);
    const result = await client.getPricesByAddress([
      { network: "eth-mainnet", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606EB48" },
    ]);

    expect(
      result.get("eth-mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    ).toBe(2.5);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("caches and correctly re-reads a 'no price found' result as null, not a cache miss", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            network: "eth-mainnet",
            address: "0x0000000000000000000000000000000000dead",
            prices: [],
            error: "no price found",
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const valkey = fakeValkey();
    const client = makeClient(valkey);
    const pair = {
      network: "eth-mainnet",
      address: "0x0000000000000000000000000000000000dEaD",
    };

    const first = await client.getPricesByAddress([pair]);
    expect(first.get("eth-mainnet:0x0000000000000000000000000000000000dead")).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call must hit the cache, not fetch again — proves the `{usd:
    // null}` cache entry round-trips as a genuine hit through the real
    // ValkeyService JSON semantics, not a miss.
    const second = await client.getPricesByAddress([pair]);
    expect(second.get("eth-mainnet:0x0000000000000000000000000000000000dead")).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("resolves to null for every pair without throwing when no API key is configured", async () => {
    const valkey = fakeValkey();
    global.fetch = jest.fn() as unknown as typeof fetch;
    const client = makeClient(valkey, fakeConfigNoKey);

    const result = await client.getPricesByAddress([
      { network: "eth-mainnet", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606EB48" },
    ]);

    expect(
      result.get("eth-mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    ).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("degrades to null (never throws) when the request fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const valkey = fakeValkey();
    const client = makeClient(valkey);
    const result = await client.getPricesByAddress([
      { network: "eth-mainnet", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606EB48" },
    ]);

    expect(
      result.get("eth-mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    ).toBeNull();
  });
});

describe("AlchemyPricesClient.getPricesBySymbol", () => {
  it("fetches and caches a native-asset price by symbol", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            symbol: "ETH",
            prices: [{ currency: "USD", value: "3000.00", lastUpdatedAt: "" }],
            error: null,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const valkey = fakeValkey();
    const client = makeClient(valkey);
    const result = await client.getPricesBySymbol(["ETH"]);

    expect(result.get("ETH")).toBe(3000);
    expect(valkey.set).toHaveBeenCalledWith(
      "alchemy-prices:sym:ETH",
      { usd: 3000 },
      { ttl: 60 },
    );
  });
});
