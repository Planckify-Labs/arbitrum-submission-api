/**
 * SuiLstSource — synthesizes the Sui liquid-staking opportunity rows that
 * DeFiLlama's /pools feed omits (Phase 3). The crux: APY/TVL are REAL (live RPC
 * + DeFiLlama), cached with a last-good fallback, and the source NEVER fabricates
 * an APY — it emits nothing rather than a guessed number.
 */

jest.mock("../targets/sui-rpc", () => ({
  ...jest.requireActual("../targets/sui-rpc"),
  getSuiNetworkStakingApy: jest.fn(),
}));

import { getSuiNetworkStakingApy } from "../targets/sui-rpc";
import { SUI_LST_VENUES } from "../targets/sui-lst.config";
import { SuiLstSource } from "./sui-lst.source";

const mockApy = getSuiNetworkStakingApy as jest.MockedFunction<
  typeof getSuiNetworkStakingApy
>;

/** Fake ValkeyService with an in-memory store; get JSON-parses like the real one. */
function fakeValkey(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) store.set(k, String(v));
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

const fakeConfig = { get: () => "https://api.llama.fi" };

function makeSource(valkey: ReturnType<typeof fakeValkey>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new SuiLstSource(fakeConfig as any, valkey as any);
}

/** Mock `fetch` so /tvl/{slug} returns `tvlBySlug[slug]` (or 404 when absent). */
function mockFetchTvl(tvlBySlug: Record<string, number>) {
  global.fetch = jest.fn(async (url: string | URL) => {
    const slug = String(url).split("/tvl/")[1] ?? "";
    const tvl = tvlBySlug[slug];
    if (tvl == null) return { ok: false, json: async () => ({}) } as Response;
    return { ok: true, json: async () => tvl } as Response;
  }) as unknown as typeof fetch;
}

const ALL_TVL: Record<string, number> = {
  "haedal-protocol": 27_000_000,
  "volo-lst": 17_000_000,
  springsui: 50_000_000,
  "aftermath-afsui": 2_400_000,
};

afterEach(() => jest.clearAllMocks());

describe("SuiLstSource", () => {
  it("synthesizes one real-data row per venue (APY→percent, correct shape)", async () => {
    mockApy.mockResolvedValue(0.026); // 2.6% as a fraction
    mockFetchTvl(ALL_TVL);
    const pools = await makeSource(fakeValkey()).getPools();

    expect(pools).toHaveLength(SUI_LST_VENUES.length);
    const haedal = pools.find((p) => p.project === "haedal-protocol");
    expect(haedal).toMatchObject({
      pool: "sui-lst-haedal",
      chain: "Sui",
      symbol: "SUI",
      apy: 2.6,
      apyBase: 2.6,
      exposure: "single",
      ilRisk: "no",
      poolMeta: "haSUI",
      tvlUsd: 27_000_000,
    });
    expect(haedal?.underlyingTokens?.[0]).toContain("::sui::SUI");
  });

  it("emits nothing when APY is unavailable and uncached (never fabricates)", async () => {
    mockApy.mockResolvedValue(null);
    mockFetchTvl(ALL_TVL);
    const pools = await makeSource(fakeValkey()).getPools();
    expect(pools).toEqual([]);
  });

  it("falls back to the cached last-good APY on a transient RPC failure", async () => {
    mockApy.mockResolvedValue(null);
    mockFetchTvl(ALL_TVL);
    // last-good APY stored as a percent
    const valkey = fakeValkey({ "strategies:lst:apy_pct": 2.9 });
    const pools = await makeSource(valkey).getPools();
    expect(pools).toHaveLength(SUI_LST_VENUES.length);
    expect(pools[0].apy).toBe(2.9);
  });

  it("skips only the venue whose TVL is unavailable and uncached", async () => {
    mockApy.mockResolvedValue(0.026);
    mockFetchTvl({ ...ALL_TVL, springsui: undefined as unknown as number });
    const pools = await makeSource(fakeValkey()).getPools();
    expect(pools).toHaveLength(SUI_LST_VENUES.length - 1);
    expect(pools.find((p) => p.project === "springsui")).toBeUndefined();
  });

  it("reuses cached TVL when a fresh fetch fails", async () => {
    mockApy.mockResolvedValue(0.026);
    mockFetchTvl({ ...ALL_TVL, springsui: undefined as unknown as number });
    const valkey = fakeValkey({ "strategies:lst:tvl:springsui": 48_000_000 });
    const pools = await makeSource(valkey).getPools();
    expect(pools).toHaveLength(SUI_LST_VENUES.length);
    expect(pools.find((p) => p.project === "springsui")?.tvlUsd).toBe(
      48_000_000,
    );
  });
});
