/**
 * Address-book drift — the ON-CHAIN half of the guard.
 *
 * `address-book.spec.ts` proves the table is well-formed. This one proves the
 * addresses are the contracts we think they are, by asking each protocol's OWN
 * registry rather than trusting the constant:
 *
 *   Aave forks   pool.ADDRESSES_PROVIDER().getPool() === the pinned Pool
 *   4626 vaults  vault.asset()                       === the pinned asset
 *   Solidly      router.defaultFactory()             === the pinned factory
 *   Uniswap      positionManager.factory()/poolManager() is non-zero
 *   Comet        comet.baseToken() is non-zero (and its symbol is reported)
 *   Morpho       morpho.owner() is non-zero
 *   Curve        addressProvider.get_address(7) is non-zero
 *
 * That round-trip is the "second official source" the README asks for, except
 * it cannot go stale and cannot be transcribed wrong — it IS the deployment.
 *
 * ## Why this is opt-in
 *
 * It needs network and a working RPC per chain, so it must not run in the unit
 * suite. Enable it explicitly:
 *
 *   ADDRESS_BOOK_DRIFT=1 \
 *   STRATEGIES_RPC_URL_1=https://... \
 *   STRATEGIES_RPC_URL_8453=https://... \
 *   npx jest src/strategies/targets/address-book/address-book-drift
 *
 * Endpoints come from the same `STRATEGIES_RPC_URL_<chainId>` overrides
 * `rpc.ts` reads, so pointing it at a fork or at the rpc-proxy is a env change.
 * A chain with no endpoint is SKIPPED and named in the output — an unchecked
 * chain must never read as a passing chain.
 *
 * Run it nightly. A protocol that migrates its Pool, or a constant that was
 * wrong from the day it was typed, shows up here and nowhere else.
 */

import {
  http,
  type Address as ViemAddress,
  createPublicClient,
  getAddress,
  parseAbi,
} from "viem";
import {
  BALANCER_V2_CHAINS,
  BALANCER_V2_VAULT,
  BALANCER_V3_VAULTS,
  CURVE_ADDRESS_PROVIDER,
  CURVE_METAREGISTRY_ID,
  PENDLE_ROUTER,
  SOLIDLY_DEPLOYMENTS,
  UNISWAP_V3_POSITION_MANAGERS,
  UNISWAP_V4_POSITION_MANAGERS,
} from "./dex";
import { AAVE_FORK_POOL_BOOKS, PINNED_VAULT_BOOKS } from "./index";
import { COMET_MARKETS, MORPHO_BLUE_SINGLETONS } from "./lending";
import { LST_VENUES } from "./lst";

/**
 * `DRIFT_CHECKS=1` turns on every drift check at once (this one plus
 * `external-api-drift.spec.ts`); `ADDRESS_BOOK_DRIFT=1` runs only this file,
 * for when you are iterating on the address book alone.
 */
const ENABLED =
  process.env.ADDRESS_BOOK_DRIFT?.trim() === "1" ||
  process.env.DRIFT_CHECKS?.trim() === "1";
const ZERO = "0x0000000000000000000000000000000000000000";
const TIMEOUT_MS = 180_000;

const ABI = parseAbi([
  "function ADDRESSES_PROVIDER() view returns (address)",
  "function getPool() view returns (address)",
  "function baseToken() view returns (address)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function get_address(uint256 id) view returns (address)",
  "function asset() view returns (address)",
  "function defaultFactory() view returns (address)",
  "function factory() view returns (address)",
  "function poolManager() view returns (address)",
  "function getAuthorizer() view returns (address)",
]);

type Client = ReturnType<typeof createPublicClient>;

const clients = new Map<number, Client | null>();

function clientFor(chainId: number): Client | null {
  if (clients.has(chainId)) return clients.get(chainId) ?? null;
  const url = process.env[`STRATEGIES_RPC_URL_${chainId}`]?.trim();
  const client = url
    ? createPublicClient({ transport: http(url, { timeout: 20_000 }) })
    : null;
  clients.set(chainId, client);
  return client;
}

/** A failed probe. Collected rather than thrown so one run reports everything. */
interface Drift {
  readonly what: string;
  readonly detail: string;
}

const drifts: Drift[] = [];
const skipped = new Set<number>();
/** Reported so a run that checked almost nothing is visible as such. */
let probed = 0;

function fail(what: string, detail: string): void {
  drifts.push({ what, detail });
}

async function read<T>(
  client: Client,
  address: string,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T | null> {
  try {
    return (await client.readContract({
      address: address as ViemAddress,
      abi: ABI,
      functionName: functionName as never,
      args: args as never,
    })) as T;
  } catch {
    return null;
  }
}

async function requireCode(
  client: Client,
  chainId: number,
  address: string,
  what: string,
): Promise<boolean> {
  probed++;
  const code = await client
    .getCode({ address: address as ViemAddress })
    .catch(() => undefined);
  if (!code || code === "0x") {
    fail(what, `no code at ${address} on chain ${chainId}`);
    return false;
  }
  return true;
}

function nonZero(value: string | null | undefined): boolean {
  return !!value && value.toLowerCase() !== ZERO.toLowerCase();
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

/**
 * Walk every chain in a book, resolving the client once. Returns the chains
 * that had no endpoint so they can be reported as unchecked.
 */
async function forEachChain(
  chainIds: readonly number[],
  fn: (client: Client, chainId: number) => Promise<void>,
): Promise<void> {
  for (const chainId of chainIds) {
    const client = clientFor(chainId);
    if (!client) {
      skipped.add(chainId);
      continue;
    }
    await fn(client, chainId);
  }
}

async function checkAaveForks(): Promise<void> {
  for (const [family, book] of Object.entries(AAVE_FORK_POOL_BOOKS)) {
    await forEachChain(
      Object.keys(book).map(Number),
      async (client, chainId) => {
        const pool = book[chainId];
        const what = `aave-fork:${family} chain=${chainId}`;
        if (!(await requireCode(client, chainId, pool, what))) return;

        // The round-trip: the Pool names its provider, the provider names the
        // current Pool. A stale or mistyped Pool breaks the loop.
        const provider = await read<string>(client, pool, "ADDRESSES_PROVIDER");
        if (!nonZero(provider)) {
          fail(
            what,
            `${pool} does not expose ADDRESSES_PROVIDER() — not an Aave-shaped Pool`,
          );
          return;
        }
        const current = await read<string>(
          client,
          provider as string,
          "getPool",
        );
        if (!sameAddress(current, pool)) {
          fail(
            what,
            `provider ${provider} reports Pool ${current ?? "<unreadable>"} but the book pins ${pool}`,
          );
        }
      },
    );
  }
}

async function checkComets(): Promise<void> {
  await forEachChain(
    Object.keys(COMET_MARKETS).map(Number),
    async (client, chainId) => {
      for (const comet of COMET_MARKETS[chainId]) {
        const what = `compound-v3 chain=${chainId}`;
        if (!(await requireCode(client, chainId, comet, what))) continue;
        const base = await read<string>(client, comet, "baseToken");
        if (!nonZero(base)) {
          fail(what, `${comet} does not expose baseToken() — not a Comet`);
          continue;
        }
        // Reported, not asserted: the symbol is what a reviewer eyeballs against
        // the `// cUSDCv3` comment in the book.
        const symbol = await read<string>(client, comet, "symbol");
        if (symbol)
          console.log(`    comet ${comet} chain=${chainId} → ${symbol}`);
      }
    },
  );
}

async function checkMorpho(): Promise<void> {
  await forEachChain(
    Object.keys(MORPHO_BLUE_SINGLETONS).map(Number),
    async (client, chainId) => {
      const morpho = MORPHO_BLUE_SINGLETONS[chainId];
      const what = `morpho-blue chain=${chainId}`;
      if (!(await requireCode(client, chainId, morpho, what))) return;
      const owner = await read<string>(client, morpho, "owner");
      if (!nonZero(owner)) {
        fail(
          what,
          `${morpho} does not expose owner() — not the Morpho singleton`,
        );
      }
    },
  );
}

async function checkPinnedVaults(): Promise<void> {
  const seen = new Set<string>();
  for (const book of Object.values(PINNED_VAULT_BOOKS)) {
    await forEachChain(
      Object.keys(book).map(Number),
      async (client, chainId) => {
        for (const v of book[chainId]) {
          const key = `${chainId}:${v.vault.toLowerCase()}`;
          if (seen.has(key)) continue; // Sky and Spark share one book.
          seen.add(key);

          const what = `vault:${v.label} chain=${chainId}`;
          if (!(await requireCode(client, chainId, v.vault, what))) continue;
          // The strongest check in the file: a 4626 vault states its own
          // underlying, so a wrong vault cannot agree with the pinned asset.
          const asset = await read<string>(client, v.vault, "asset");
          if (!sameAddress(asset, v.asset)) {
            fail(
              what,
              `${v.vault}.asset() = ${asset ?? "<unreadable>"} but the book pins ${v.asset}`,
            );
          }
        }
      },
    );
  }
}

async function checkSolidly(): Promise<void> {
  await forEachChain(
    Object.keys(SOLIDLY_DEPLOYMENTS).map(Number),
    async (client, chainId) => {
      const dep = SOLIDLY_DEPLOYMENTS[chainId];
      const what = `solidly:${dep.label} chain=${chainId}`;
      if (!(await requireCode(client, chainId, dep.router, what))) return;
      // Forks disagree on the accessor name; either proving the pinned factory
      // is enough.
      const viaDefault = await read<string>(
        client,
        dep.router,
        "defaultFactory",
      );
      const viaFactory = viaDefault
        ? null
        : await read<string>(client, dep.router, "factory");
      const reported = viaDefault ?? viaFactory;
      if (!sameAddress(reported, dep.factory)) {
        fail(
          what,
          `router ${dep.router} reports factory ${reported ?? "<unreadable>"} but the book pins ${dep.factory}`,
        );
      }
    },
  );
}

async function checkUniswap(): Promise<void> {
  await forEachChain(
    Object.keys(UNISWAP_V3_POSITION_MANAGERS).map(Number),
    async (client, chainId) => {
      const pm = UNISWAP_V3_POSITION_MANAGERS[chainId];
      const what = `uniswap-v3 chain=${chainId}`;
      if (!(await requireCode(client, chainId, pm, what))) return;
      if (!nonZero(await read<string>(client, pm, "factory"))) {
        fail(
          what,
          `${pm} does not expose factory() — not a v3 PositionManager`,
        );
      }
    },
  );
  await forEachChain(
    Object.keys(UNISWAP_V4_POSITION_MANAGERS).map(Number),
    async (client, chainId) => {
      const pm = UNISWAP_V4_POSITION_MANAGERS[chainId];
      const what = `uniswap-v4 chain=${chainId}`;
      if (!(await requireCode(client, chainId, pm, what))) return;
      if (!nonZero(await read<string>(client, pm, "poolManager"))) {
        fail(
          what,
          `${pm} does not expose poolManager() — not a v4 PositionManager`,
        );
      }
    },
  );
}

async function checkBalancer(): Promise<void> {
  await forEachChain(BALANCER_V2_CHAINS, async (client, chainId) => {
    const what = `balancer-v2 chain=${chainId}`;
    if (!(await requireCode(client, chainId, BALANCER_V2_VAULT, what))) return;
    if (
      !nonZero(await read<string>(client, BALANCER_V2_VAULT, "getAuthorizer"))
    ) {
      fail(
        what,
        `${BALANCER_V2_VAULT} does not expose getAuthorizer() — not the v2 Vault`,
      );
    }
  });
  await forEachChain(
    Object.keys(BALANCER_V3_VAULTS).map(Number),
    async (client, chainId) => {
      await requireCode(
        client,
        chainId,
        BALANCER_V3_VAULTS[chainId],
        `balancer-v3 chain=${chainId}`,
      );
    },
  );
}

async function checkCurveAndPendle(): Promise<void> {
  // Both are one deterministic deployment across chains, so any chain with an
  // endpoint proves them; check every chain we have one for.
  const chainIds = [
    ...new Set(Object.keys(AAVE_FORK_POOL_BOOKS.aave).map(Number)),
  ];
  await forEachChain(chainIds, async (client, chainId) => {
    const curveWhat = `curve chain=${chainId}`;
    if (await requireCode(client, chainId, CURVE_ADDRESS_PROVIDER, curveWhat)) {
      const registry = await read<string>(
        client,
        CURVE_ADDRESS_PROVIDER,
        "get_address",
        [BigInt(CURVE_METAREGISTRY_ID)],
      );
      if (!nonZero(registry)) {
        fail(
          curveWhat,
          `AddressProvider.get_address(${CURVE_METAREGISTRY_ID}) is empty — the MetaRegistry slot moved`,
        );
      }
    }
    await requireCode(
      client,
      chainId,
      PENDLE_ROUTER,
      `pendle chain=${chainId}`,
    );
  });
}

async function checkLstVenues(): Promise<void> {
  await forEachChain(
    [...new Set(LST_VENUES.map((v) => v.chainId))],
    async (client, chainId) => {
      for (const venue of LST_VENUES.filter((v) => v.chainId === chainId)) {
        const what = `lst:${venue.key}`;
        await requireCode(client, chainId, venue.entry, `${what} entry`);
        if (venue.receipt.toLowerCase() !== venue.entry.toLowerCase()) {
          await requireCode(client, chainId, venue.receipt, `${what} receipt`);
        }
        const symbol = await read<string>(client, venue.receipt, "symbol");
        if (symbol) console.log(`    lst ${venue.key} receipt → ${symbol}`);
      }
    },
  );
}

const maybeDescribe = ENABLED ? describe : describe.skip;

maybeDescribe("address book — on-chain drift", () => {
  beforeAll(async () => {
    await checkAaveForks();
    await checkComets();
    await checkMorpho();
    await checkPinnedVaults();
    await checkSolidly();
    await checkUniswap();
    await checkBalancer();
    await checkCurveAndPendle();
    await checkLstVenues();
  }, TIMEOUT_MS);

  it("checked something (a run with no endpoints is not a passing run)", () => {
    if (skipped.size) {
      console.warn(
        `[drift] SKIPPED chains (no STRATEGIES_RPC_URL_<id>): ${[...skipped].sort((a, b) => a - b).join(", ")}`,
      );
    }
    expect(probed).toBeGreaterThan(0);
  });

  it("finds no pinned address that disagrees with its own protocol", () => {
    // One assertion for the whole book so a run reports EVERY drift at once —
    // fixing them one failed test at a time would take one nightly run each.
    expect(drifts.map((d) => `${d.what}: ${d.detail}`)).toEqual([]);
  });
});

/**
 * Kept out of the gated block so the file still exercises its own helpers when
 * the networked half is off — otherwise a refactor could break this spec and
 * nobody would learn until the nightly run.
 */
describe("address book drift — helpers", () => {
  it("treats the zero address as empty", () => {
    expect(nonZero(ZERO)).toBe(false);
    expect(nonZero("0x1111111111111111111111111111111111111111")).toBe(true);
    expect(nonZero(null)).toBe(false);
  });

  it("compares addresses case-insensitively", () => {
    const a = getAddress("0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2");
    expect(sameAddress(a.toLowerCase(), a)).toBe(true);
    expect(sameAddress(ZERO, a)).toBe(false);
    expect(sameAddress(null, a)).toBe(false);
  });

  it("is skipped unless a drift gate is set", () => {
    // Documents the gate: a networked check that ran by accident in the unit
    // suite would make CI depend on third-party RPC uptime.
    expect(ENABLED).toBe(
      process.env.ADDRESS_BOOK_DRIFT?.trim() === "1" ||
        process.env.DRIFT_CHECKS?.trim() === "1",
    );
  });
});
