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
 *   Curve        addressProvider.get_id_info(id) is active AND describes
 *                itself as "Metaregistry" (non-zero alone is NOT enough — on
 *                Polygon the old id 7 is an active "Cryptopool Factory")
 *   Pendle       the router holds code on each PENDLE_ROUTER_CHAINS entry
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
 *
 * With no overrides set it uses Alchemy (ALCHEMY_API_KEY, falling back to
 * ALCHEMY_PRICES_API_KEY) from .env, so the usual case needs no extra
 * configuration at all.
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
  BALANCER_QUERIES,
  BALANCER_V2_CHAINS,
  BALANCER_V2_VAULT,
  BALANCER_V3_VAULTS,
  CURVE_ADDRESS_PROVIDER,
  CURVE_METAREGISTRY_DESCRIPTION,
  CURVE_METAREGISTRY_IDS,
  PENDLE_ROUTER,
  PENDLE_ROUTER_CHAINS,
  SOLIDLY_DEPLOYMENTS,
  UNISWAP_V2_DEPLOYMENTS,
  UNISWAP_V3_POSITION_MANAGERS,
  UNISWAP_V4_POSITION_MANAGERS,
} from "./dex";
import { AAVE_FORK_POOL_BOOKS, PINNED_VAULT_BOOKS } from "./index";
import { COMET_MARKETS, MORPHO_BLUE_SINGLETONS } from "./lending";
import { LST_VENUES } from "./lst";
import {
  CHAINLINK_FEEDS,
  FEED_STALENESS_FACTOR,
  MORPHO_CHAINLINK_ORACLE_FACTORIES,
} from "./oracles";

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
  "function get_id_info(uint256 id) view returns (address addr, bool is_active, uint256 version, uint256 last_modified, string description)",
  "function asset() view returns (address)",
  "function defaultFactory() view returns (address)",
  "function factory() view returns (address)",
  "function poolManager() view returns (address)",
  "function getAuthorizer() view returns (address)",
  "function vault() view returns (address)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function isMorphoChainlinkOracleV2(address) view returns (bool)",
]);

type Client = ReturnType<typeof createPublicClient>;

const clients = new Map<number, Client | null>();

/**
 * Alchemy network slug per pinned chain. Every chainId the address book pins
 * appears here, INCLUDING chains that have no `Blockchain` row yet (56, 43114,
 * …) — a pin has to be verifiable before the chain is seeded, otherwise the
 * addresses go live unchecked on the day someone adds the row.
 *
 * Verified against `eth_chainId` on 2026-08-21: all ten answer.
 */
const ALCHEMY_NETWORKS: Readonly<Record<number, string>> = {
  1: "eth-mainnet",
  10: "opt-mainnet",
  56: "bnb-mainnet",
  100: "gnosis-mainnet",
  137: "polygon-mainnet",
  8453: "base-mainnet",
  42161: "arb-mainnet",
  43114: "avax-mainnet",
  59144: "linea-mainnet",
  534352: "scroll-mainnet",
};

/**
 * Where this chain's RPC comes from.
 *
 * `STRATEGIES_RPC_URL_<chainId>` stays the ops escape hatch, but it cannot be
 * the only mechanism: this repo's own `rpc-proxy` authenticates with a Bearer
 * header, which a bare URL override cannot carry, so an engineer following the
 * runbook had to go and find public endpoints before this suite would probe
 * anything. That is a large part of why it has never been scheduled (§12.4)
 * and why its first-ever run was during the security sign-off.
 *
 * Alchemy is the default instead: one key already in `.env`, every pinned
 * chain, and no dependence on which chains happen to be seeded.
 */
function endpointFor(chainId: number): string | null {
  const override = process.env[`STRATEGIES_RPC_URL_${chainId}`]?.trim();
  if (override) return override;

  const key =
    process.env.ALCHEMY_API_KEY?.trim() ||
    process.env.ALCHEMY_PRICES_API_KEY?.trim();
  const network = ALCHEMY_NETWORKS[chainId];
  if (!key || !network) return null;
  return `https://${network}.g.alchemy.com/v2/${key}`;
}

function clientFor(chainId: number): Client | null {
  if (clients.has(chainId)) return clients.get(chainId) ?? null;
  const url = endpointFor(chainId);
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
  await forEachChain(
    Object.keys(UNISWAP_V2_DEPLOYMENTS).map(Number),
    async (client, chainId) => {
      const dep = UNISWAP_V2_DEPLOYMENTS[chainId];
      const what = `uniswap-v2 chain=${chainId}`;
      if (!(await requireCode(client, chainId, dep.router, what))) return;
      const reported = await read<string>(client, dep.router, "factory");
      if (!sameAddress(reported, dep.factory)) {
        fail(
          what,
          `router ${dep.router} reports factory ${reported ?? "<unreadable>"} but the book pins ${dep.factory}`,
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
  // BalancerQueries is deployed independently per chain (not one address
  // everywhere like the Vault), so its identity proof is different: it must
  // round-trip to the SAME v2 Vault we pinned, via its own immutable `vault()`.
  await forEachChain(
    Object.keys(BALANCER_QUERIES).map(Number),
    async (client, chainId) => {
      const queries = BALANCER_QUERIES[chainId];
      const what = `balancer-queries chain=${chainId}`;
      if (!(await requireCode(client, chainId, queries, what))) return;
      const reportedVault = await read<string>(client, queries, "vault");
      if (!reportedVault || !nonZero(reportedVault)) {
        fail(what, `${queries} does not expose vault() — not BalancerQueries`);
        return;
      }
      if (reportedVault.toLowerCase() !== BALANCER_V2_VAULT.toLowerCase()) {
        fail(
          what,
          `${queries}.vault() = ${reportedVault}, expected the pinned v2 Vault ${BALANCER_V2_VAULT}`,
        );
      }
    },
  );
}

async function checkCurveAndPendle(): Promise<void> {
  // NEITHER of these is "one deployment that exists everywhere", which is what
  // this function used to assume. Both are deterministic ADDRESSES on the
  // chains their protocol actually deployed to, so each is checked against its
  // own pinned chain set — otherwise every unsupported chain reports drift
  // (noise) while the one genuinely wrong chain hides in it (Polygon, below).

  // Curve: only the chains that pin a MetaRegistry id, and the slot must
  // describe ITSELF as the MetaRegistry. "Non-zero" was not enough — on Polygon
  // id 7 is an active, non-zero "Cryptopool Factory", so the old assertion
  // passed while the read was wrong.
  await forEachChain(
    Object.keys(CURVE_METAREGISTRY_IDS).map(Number),
    async (client, chainId) => {
      const id = CURVE_METAREGISTRY_IDS[chainId];
      const what = `curve chain=${chainId}`;
      if (!(await requireCode(client, chainId, CURVE_ADDRESS_PROVIDER, what))) {
        return;
      }
      const info = await read<[string, boolean, bigint, bigint, string]>(
        client,
        CURVE_ADDRESS_PROVIDER,
        "get_id_info",
        [BigInt(id)],
      );
      if (!info) {
        fail(what, `AddressProvider.get_id_info(${id}) did not answer`);
        return;
      }
      const [addr, isActive, , , description] = info;
      if (!nonZero(addr)) {
        fail(what, `AddressProvider.get_address(${id}) is empty`);
      } else if (!isActive) {
        fail(what, `AddressProvider id ${id} is INACTIVE`);
      } else if (
        description.trim().toLowerCase() !==
        CURVE_METAREGISTRY_DESCRIPTION.toLowerCase()
      ) {
        fail(
          what,
          `AddressProvider id ${id} describes itself as "${description.trim()}", not "${CURVE_METAREGISTRY_DESCRIPTION}" — the slot moved and a wrong registry would answer silently`,
        );
      }
    },
  );

  // Pendle: only the chains the router is actually deployed on.
  await forEachChain(PENDLE_ROUTER_CHAINS, async (client, chainId) => {
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

/**
 * The oracle-provenance half of the Morpho Blue gate (§12 Q6).
 *
 * Two questions, because the gate rests on two independent claims:
 *
 *   1. Is the pinned factory really a `MorphoChainlinkOracleV2Factory`? Probed
 *      by asking it about an address it cannot possibly have deployed — a
 *      contract that answers `false` there is at least shaped like the factory,
 *      whereas one that reverts or answers `true` is not the factory at all.
 *   2. Is each pinned feed still the pair we think, and still alive? A feed
 *      that gets re-pointed or decommissioned is the bad-debt scenario the
 *      whole gate exists to prevent, and nothing else in the suite would see it.
 */
async function checkOracleProvenance(): Promise<void> {
  await forEachChain(
    Object.keys(MORPHO_CHAINLINK_ORACLE_FACTORIES).map(Number),
    async (client, chainId) => {
      const factory = MORPHO_CHAINLINK_ORACLE_FACTORIES[chainId];
      const what = `morpho-oracle-factory chain=${chainId}`;
      if (!(await requireCode(client, chainId, factory, what))) return;
      // A never-deployed probe address: the mapping must answer, and answer no.
      const claimed = await read<boolean>(
        client,
        factory,
        "isMorphoChainlinkOracleV2",
        ["0x0000000000000000000000000000000000000001"],
      );
      if (claimed === null) {
        fail(
          what,
          `${factory} has no isMorphoChainlinkOracleV2 — not the factory`,
        );
      } else if (claimed !== false) {
        fail(what, `${factory} claims to have deployed 0x…01 — wrong contract`);
      }
    },
  );

  await forEachChain(
    Object.keys(CHAINLINK_FEEDS).map(Number),
    async (client, chainId) => {
      const nowSec = Math.floor(Date.now() / 1000);
      for (const feed of CHAINLINK_FEEDS[chainId] ?? []) {
        const what = `chainlink ${feed.pair} chain=${chainId}`;
        if (!(await requireCode(client, chainId, feed.address, what))) continue;

        const description = await read<string>(
          client,
          feed.address,
          "description",
        );
        if (description === null) {
          fail(
            what,
            `${feed.address} has no description() — not a Chainlink feed`,
          );
          continue;
        }
        if (description.trim() !== feed.pair) {
          fail(
            what,
            `${feed.address} reports "${description}", pinned as "${feed.pair}"`,
          );
        }

        const round = await read<
          readonly [bigint, bigint, bigint, bigint, bigint]
        >(client, feed.address, "latestRoundData");
        if (!round) {
          fail(what, `${feed.address} latestRoundData() reverted`);
          continue;
        }
        if (round[1] <= 0n) {
          fail(
            what,
            `${feed.address} answers ${round[1]} — non-positive price`,
          );
        }
        const age = nowSec - Number(round[3]);
        // Same bound the resolver enforces, so a feed that would silently take
        // its markets to Manual shows up here as a named failure instead.
        if (age > feed.heartbeatSec * FEED_STALENESS_FACTOR) {
          fail(
            what,
            `${feed.address} last updated ${age}s ago, heartbeat ${feed.heartbeatSec}s`,
          );
        }
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
    await checkOracleProvenance();
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
