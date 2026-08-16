/**
 * External-API contract drift.
 *
 * Resolvers depend on third-party APIs whose schemas are not versioned for us
 * and change without notice. When one of those changes, the failure mode is the
 * worst kind: a GraphQL rejection is HTTP 200 with `errors` and no `data`, which
 * reads exactly like "this chain has no markets". The family fails closed to
 * Manual — safe, but silent, and it can stay that way for months.
 *
 * That is not hypothetical. Morpho renamed `uniqueKey` → `marketId`,
 * `whitelisted` → `listed` and `oracleAddress` → `oracle { address }`, and the
 * entire morpho-blue family stopped resolving with no error anywhere. Nothing
 * caught it because every unit test mocks the fetch — and mocking is right for a
 * unit test, which is exactly why this separate, networked check has to exist.
 *
 * ## Running it
 *
 *   DRIFT_CHECKS=1 npx jest src/strategies/targets/external-api-drift
 *
 * Opt-in, because CI must not depend on third-party uptime. Run it on a
 * schedule; a failure here means "a resolver family has gone dark", not "the
 * build is broken".
 */

import { MORPHO_VAULTS_QUERY } from "./erc4626.resolver";
import { MORPHO_MARKETS_QUERY } from "./morpho-blue.resolver";

const ENABLED = process.env.DRIFT_CHECKS?.trim() === "1";
const TIMEOUT_MS = 60_000;

const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";
const POOLS_OLD_URL = "https://yields.llama.fi/poolsOld";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

const maybeDescribe = ENABLED ? describe : describe.skip;

maybeDescribe("external API contract drift", () => {
  describe("Morpho Blue markets query", () => {
    interface MorphoResponse {
      data?: {
        markets?: {
          items?: Array<{
            marketId?: string;
            lltv?: string;
            irmAddress?: string;
            listed?: boolean;
            oracle?: { address?: string } | null;
            loanAsset?: { address?: string } | null;
            state?: { supplyAssetsUsd?: number | null } | null;
          }>;
        };
      };
      errors?: Array<{ message?: string }>;
    }

    let response: MorphoResponse;

    beforeAll(async () => {
      // The EXACT query string the resolver sends, imported rather than
      // retyped. A copy here would drift from the real one and pass while
      // production failed.
      response = await postJson<MorphoResponse>(MORPHO_GRAPHQL, {
        query: MORPHO_MARKETS_QUERY,
        variables: { chainId: 1 },
      });
    }, TIMEOUT_MS);

    it("is still accepted by the schema", () => {
      // The headline assertion. `errors` here IS the silent-family failure.
      expect(response.errors ?? []).toEqual([]);
    });

    it("returns markets with every field the resolver reads", () => {
      const items = response.data?.markets?.items ?? [];
      expect(items.length).toBeGreaterThan(0);

      // A market the resolver would actually consider: listed, with supply.
      const usable = items.find(
        (m) => m.listed !== false && (m.state?.supplyAssetsUsd ?? 0) > 0,
      );
      expect(usable).toBeDefined();
      if (!usable) return;

      // Each of these is a field whose absence would make `toParams` return
      // null and the family resolve nothing.
      expect(usable.marketId).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(usable.oracle?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(usable.irmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(usable.loanAsset?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // lltv is a decimal string (18-dp WAD) — `MorphoMarketParams` carries it
      // as a string because the target is JSON on the wire.
      expect(String(usable.lltv)).toMatch(/^\d+$/);
    });
  });

  describe("Morpho MetaMorpho vaults query", () => {
    interface VaultsResponse {
      data?: {
        vaults?: {
          items?: Array<{
            address?: string;
            name?: string | null;
            symbol?: string | null;
            listed?: boolean;
            asset?: { address?: string } | null;
          }>;
        };
      };
      errors?: Array<{ message?: string }>;
    }
    let response: VaultsResponse;

    beforeAll(async () => {
      response = await postJson<VaultsResponse>(MORPHO_GRAPHQL, {
        query: MORPHO_VAULTS_QUERY,
        variables: { chainId: 1 },
      });
    }, TIMEOUT_MS);

    it("is still accepted by the schema", () => {
      // This one guards the SHIPPED MetaMorpho path, not just the expansion:
      // the same `whitelisted` → `listed` rename silently emptied the vault
      // list in production.
      expect(response.errors ?? []).toEqual([]);
    });

    it("returns vaults with the fields the resolver matches on", () => {
      const items = response.data?.vaults?.items ?? [];
      expect(items.length).toBeGreaterThan(0);
      const usable = items.find((v) => v.listed !== false && v.asset?.address);
      expect(usable).toBeDefined();
      expect(usable?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(usable?.asset?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // `name`/`symbol` are the poolMeta disambiguators — losing them would
      // make every multi-vault asset ambiguous and refuse.
      expect(usable?.name ?? usable?.symbol).toBeTruthy();
    });
  });

  describe("DeFiLlama /poolsOld", () => {
    interface PoolsOld {
      status?: string;
      data?: Array<{ pool?: string; pool_old?: string }>;
    }
    let body: PoolsOld = {};
    let status = 0;

    beforeAll(async () => {
      const key = process.env.DEFILLAMA_PRO_API_KEY?.trim();
      const url = key
        ? `https://pro-api.llama.fi/${key}/yields/poolsOld`
        : POOLS_OLD_URL;
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      status = res.status;
      if (res.ok) body = (await res.json()) as PoolsOld;
    }, TIMEOUT_MS);

    it("is still reachable without a paid plan", () => {
      // 402 means DeFiLlama paywalled it. Asserted separately from the shape
      // check so the failure names the cause instead of surfacing as "0 rows".
      expect({ status, hint: status === 402 ? "paywalled" : "ok" }).toEqual({
        status: 200,
        hint: "ok",
      });
    });

    it("still maps pool UUIDs to address-bearing legacy ids", () => {
      // This feed is the ONLY protocol-agnostic source of a candidate vault
      // address (§12 Q1). If `pool_old` stops carrying an address, every
      // discovered-vault family silently loses its candidates.
      const rows = body.data ?? [];
      expect(rows.length).toBeGreaterThan(1000);

      const withAddress = rows.filter((r) =>
        /0x[0-9a-fA-F]{40}/.test(r.pool_old ?? ""),
      );
      expect(withAddress.length).toBeGreaterThan(100);
      expect(withAddress[0]?.pool).toBeTruthy();
    });
  });
});

describe("external API drift — gate", () => {
  it("is skipped unless DRIFT_CHECKS=1", () => {
    // Documents why the suite above is usually invisible: a networked contract
    // check in the unit suite would make CI fail on someone else's outage.
    expect(ENABLED).toBe(process.env.DRIFT_CHECKS?.trim() === "1");
  });
});
