/**
 * Address-book invariants — the OFFLINE half of the drift guard.
 *
 * The address book is pinned code precisely so an attacker cannot change a
 * `tx.to` without a review (see ./README.md). The cost of that choice is that
 * the table rots silently: a transcribed constant can be wrong from day one and
 * nothing notices, because a wrong address fails closed to Manual rather than
 * throwing. That is safe, but it is also invisible.
 *
 * This spec is the cheap half of the answer — pure structural checks that need
 * no network and therefore run on every CI pass:
 *
 *   - every address is a valid EIP-55 checksummed address (catches hand-edits,
 *     truncations and transposed characters),
 *   - nothing is the zero address,
 *   - two different protocols never claim the SAME address on the SAME chain
 *     (a copy-paste between family books),
 *   - the join keys the resolvers match on are unique.
 *
 * The expensive half — "is this actually the contract we think it is?" — needs
 * chain state and lives in ./address-book-drift.spec.ts.
 *
 * NOTE what this file deliberately cannot catch: an address that is valid,
 * unique and simply *wrong* (a real deployment, just not the one we meant).
 * Checksums pass for any well-formed address. That is exactly why the on-chain
 * round-trip exists.
 */

import { getAddress } from "viem";
import {
  BALANCER_QUERIES,
  BALANCER_V2_CHAINS,
  BALANCER_V2_VAULT,
  BALANCER_V3_VAULTS,
  CURVE_ADDRESS_PROVIDER,
  CURVE_METAREGISTRY_IDS,
  PENDLE_ROUTER,
  PENDLE_ROUTER_CHAINS,
  SOLIDLY_DEPLOYMENTS,
  UNISWAP_V3_POSITION_MANAGERS,
  UNISWAP_V4_POSITION_MANAGERS,
} from "./dex";
import {
  AAVE_FORK_POOL_BOOKS,
  PINNED_VAULT_BOOKS,
  routerAllowlist,
} from "./index";
import { COMET_MARKETS, MORPHO_BLUE_SINGLETONS } from "./lending";
import { LST_VENUES } from "./lst";
import { CHAINLINK_FEEDS, MORPHO_CHAINLINK_ORACLE_FACTORIES } from "./oracles";
import type { PinnedVaultBook } from "./vaults";

const ZERO = "0x0000000000000000000000000000000000000000";

/** One pinned address plus where it came from, so a failure names itself. */
interface Pin {
  readonly address: string;
  readonly chainId: number;
  readonly owner: string;
  readonly label: string;
}

function pin(
  address: string,
  chainId: number,
  owner: string,
  label: string,
): Pin {
  return { address, chainId, owner, label };
}

/**
 * Every pinned address in the book, flattened. Adding a family means adding it
 * here too — a book that is not collected is a book that is not checked, so
 * keep this exhaustive.
 */
function collectPins(): Pin[] {
  const pins: Pin[] = [];

  for (const [family, book] of Object.entries(AAVE_FORK_POOL_BOOKS)) {
    for (const [chainId, pool] of Object.entries(book)) {
      pins.push(pin(pool, Number(chainId), `aave-fork:${family}`, "Pool"));
    }
  }

  for (const [chainId, markets] of Object.entries(COMET_MARKETS)) {
    for (const comet of markets) {
      pins.push(pin(comet, Number(chainId), "compound-v3", "Comet"));
    }
  }

  for (const [chainId, singleton] of Object.entries(MORPHO_BLUE_SINGLETONS)) {
    pins.push(pin(singleton, Number(chainId), "morpho-blue", "Morpho"));
  }

  for (const [chainId, factory] of Object.entries(
    MORPHO_CHAINLINK_ORACLE_FACTORIES,
  )) {
    pins.push(
      pin(factory, Number(chainId), "morpho-blue", "ChainlinkOracleV2Factory"),
    );
  }

  // Chainlink feeds get their own owner: they are shared infrastructure, and
  // two Morpho markets reading the same ETH/USD feed is the normal case rather
  // than the copy-paste the collision check hunts for.
  for (const [chainId, feeds] of Object.entries(CHAINLINK_FEEDS)) {
    for (const feed of feeds) {
      pins.push(pin(feed.address, Number(chainId), "chainlink", feed.pair));
    }
  }

  // Two resolver families can legitimately SHARE one book object — Spark
  // surfaces the same sUSDS/sDAI contracts as Sky (see vaults.ts) — so collect
  // per distinct book, or the collision check below would flag that by-design
  // aliasing as a copy-paste.
  const vaultBookOwners = new Map<object, string[]>();
  for (const [family, book] of Object.entries(PINNED_VAULT_BOOKS)) {
    const owners = vaultBookOwners.get(book) ?? [];
    owners.push(family);
    vaultBookOwners.set(book, owners);
  }
  for (const [book, families] of vaultBookOwners) {
    const owner = families.sort().join("+");
    for (const [chainId, vaults] of Object.entries(book as PinnedVaultBook)) {
      for (const v of vaults) {
        // Both halves are pinned: the vault is the `tx.to`, and the asset is
        // what the resolver matches DeFiLlama's underlying against.
        pins.push(pin(v.vault, Number(chainId), `vault:${owner}`, v.label));
        // The UNDERLYING gets a shared owner, for the same reason the
        // Chainlink feeds above do: a token is shared infrastructure, and two
        // protocols running a vault over Base USDC is the normal case, not the
        // copy-paste this check hunts for. Owning it per-family made the very
        // first pair of same-asset books (40 Acres + Avantis, both USDC on
        // Base) look like a collision. The label still names the family, so a
        // genuine surprise is readable, and a VAULT that collides with another
        // protocol's vault or with any underlying is still caught.
        pins.push(
          pin(v.asset, Number(chainId), "underlying", `${owner}/${v.label}`),
        );
      }
    }
  }

  for (const [chainId, dep] of Object.entries(SOLIDLY_DEPLOYMENTS)) {
    pins.push(
      pin(dep.router, Number(chainId), "solidly", `${dep.label} router`),
    );
    pins.push(
      pin(dep.factory, Number(chainId), "solidly", `${dep.label} factory`),
    );
  }

  for (const [chainId, pm] of Object.entries(UNISWAP_V3_POSITION_MANAGERS)) {
    pins.push(pin(pm, Number(chainId), "uniswap-v3", "PositionManager"));
  }
  for (const [chainId, pm] of Object.entries(UNISWAP_V4_POSITION_MANAGERS)) {
    pins.push(pin(pm, Number(chainId), "uniswap-v4", "PositionManager"));
  }

  for (const [chainId, vault] of Object.entries(BALANCER_V3_VAULTS)) {
    pins.push(pin(vault, Number(chainId), "balancer-v3", "Vault"));
  }
  for (const chainId of BALANCER_V2_CHAINS) {
    pins.push(pin(BALANCER_V2_VAULT, chainId, "balancer-v2", "Vault"));
  }
  for (const [chainId, queries] of Object.entries(BALANCER_QUERIES)) {
    pins.push(pin(queries, Number(chainId), "balancer-v2", "BalancerQueries"));
  }

  for (const venue of LST_VENUES) {
    pins.push(pin(venue.entry, venue.chainId, `lst:${venue.key}`, "entry"));
    pins.push(pin(venue.receipt, venue.chainId, `lst:${venue.key}`, "receipt"));
  }

  // Chain-agnostic singletons — recorded against chain 0 since they are the
  // same deployment everywhere and the per-chain check does not apply.
  pins.push(pin(CURVE_ADDRESS_PROVIDER, 0, "curve", "AddressProvider"));
  pins.push(pin(PENDLE_ROUTER, 0, "pendle", "Router v4"));

  return pins;
}

const PINS = collectPins();

describe("address book — structural invariants", () => {
  it("collects a non-trivial number of pins (guards the collector itself)", () => {
    // A refactor that empties a book would otherwise make every check below
    // pass vacuously.
    expect(PINS.length).toBeGreaterThan(40);
  });

  it("stores every address in valid EIP-55 checksummed form", () => {
    const bad = PINS.filter((p) => {
      try {
        return getAddress(p.address) !== p.address;
      } catch {
        return true;
      }
    }).map((p) => `${p.owner}/${p.label} chain=${p.chainId} ${p.address}`);
    expect(bad).toEqual([]);
  });

  it("never pins the zero address", () => {
    const zeros = PINS.filter(
      (p) => p.address.toLowerCase() === ZERO.toLowerCase(),
    ).map((p) => `${p.owner}/${p.label} chain=${p.chainId}`);
    expect(zeros).toEqual([]);
  });

  it("never lets two protocols claim the same address on the same chain", () => {
    // The same deterministic deployment across DIFFERENT chains is normal
    // (Aave's Pool is one address on four chains); the same address claimed by
    // two protocols on ONE chain is a copy-paste between books.
    const seen = new Map<string, Pin>();
    const collisions: string[] = [];
    for (const p of PINS) {
      // An LST venue whose entry IS its receipt (wBETH, sAVAX mint on the
      // token) is a legitimate self-reference, not a collision.
      const key = `${p.chainId}:${p.address.toLowerCase()}`;
      const prior = seen.get(key);
      if (!prior) {
        seen.set(key, p);
        continue;
      }
      if (prior.owner === p.owner) continue;
      collisions.push(
        `chain=${p.chainId} ${p.address} claimed by ${prior.owner}/${prior.label} and ${p.owner}/${p.label}`,
      );
    }
    expect(collisions).toEqual([]);
  });

  it("never lists the same Comet twice on a chain", () => {
    const dupes: string[] = [];
    for (const [chainId, markets] of Object.entries(COMET_MARKETS)) {
      const lower = markets.map((m) => m.toLowerCase());
      if (new Set(lower).size !== lower.length) {
        dupes.push(`chain=${chainId}`);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("never pins a 4626 vault whose asset is itself", () => {
    const selfRefs: string[] = [];
    for (const [family, book] of Object.entries(PINNED_VAULT_BOOKS)) {
      for (const [chainId, vaults] of Object.entries(book)) {
        for (const v of vaults) {
          if (v.vault.toLowerCase() === v.asset.toLowerCase()) {
            selfRefs.push(`${family}/${v.label} chain=${chainId}`);
          }
        }
      }
    }
    expect(selfRefs).toEqual([]);
  });

  it("never pins a Solidly router equal to its factory", () => {
    const bad = Object.entries(SOLIDLY_DEPLOYMENTS)
      .filter(([, d]) => d.router.toLowerCase() === d.factory.toLowerCase())
      .map(([chainId, d]) => `${d.label} chain=${chainId}`);
    expect(bad).toEqual([]);
  });

  it("keeps LST venue keys and external slugs unique", () => {
    // `findLstVenuesForProject` matches on both; a duplicate would make which
    // venue a pool resolves to depend on array order.
    const keys = LST_VENUES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);

    const slugs = LST_VENUES.flatMap((v) =>
      v.externalSlugs.map((s) => `${v.chainId}:${s.toLowerCase()}`),
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("pairs a min-out stake shape with a preview view", () => {
    // A `payable-stake-minout` venue derives its floor from the protocol's own
    // quote. Without one there is nothing to derive from, and the only build
    // that could ship is a ZERO minimum — which §12 Q4 forbids outright
    // because it is an open invitation to sandwich the deposit.
    const bad = LST_VENUES.filter(
      (v) => v.shape === "payable-stake-minout" && !v.previewView,
    ).map((v) => v.key);
    expect(bad).toEqual([]);
  });

  it("never declares a preview view on a shape that cannot use one", () => {
    // The reverse, so the field cannot rot into decoration nobody reads.
    const bad = LST_VENUES.filter(
      (v) => v.previewView && v.shape !== "payable-stake-minout",
    ).map((v) => v.key);
    expect(bad).toEqual([]);
  });

  it("gives every LST venue a real chain", () => {
    const bad = LST_VENUES.filter(
      (v) => !Number.isInteger(v.chainId) || v.chainId <= 0,
    ).map((v) => v.key);
    expect(bad).toEqual([]);
  });
});

/**
 * Regressions for the two scoping defects the 2026-08-21 security sign-off
 * found (findings 5 and 6). Both are about a constant that is correct on one
 * chain being applied to every chain, and NEITHER was catchable by the checksum
 * or zero-address checks above — the addresses involved are all well-formed.
 *
 * These are unit tests on purpose: the on-chain drift spec also covers them,
 * but it is opt-in and needs an RPC per chain, and "the check exists but never
 * runs" is precisely how finding 1 survived.
 */
describe("router allowlists are scoped per chain (finding 5)", () => {
  it("returns an EMPTY pendle allowlist for chains pendle is not deployed on", () => {
    // Every directory chain where the router provably holds no code. An entry
    // here would let `isRouterAllowlisted` approve a codeless `to`, and would
    // stop `router-call.resolver`'s length===0 gate from ever firing.
    const notDeployed = [100, 137, 43114, 59144, 534352];
    const leaked = notDeployed.filter(
      (chainId) => routerAllowlist("pendle", chainId).length > 0,
    );
    expect(leaked).toEqual([]);
  });

  it("still allowlists the pendle router on every chain it IS deployed on", () => {
    const missing = PENDLE_ROUTER_CHAINS.filter(
      (chainId) => !routerAllowlist("pendle", chainId).includes(PENDLE_ROUTER),
    );
    expect(missing).toEqual([]);
  });

  it("never allowlists a uniswap position manager on an unpinned chain", () => {
    // The pattern pendle was corrected TO — guarded so it cannot regress either.
    for (const protocol of ["uniswap-v3", "uniswap-v4"] as const) {
      expect(routerAllowlist(protocol, 999_999)).toEqual([]);
    }
  });
});

describe("curve metaregistry id is per chain (finding 6)", () => {
  it("pins an id only for chains that actually have a MetaRegistry", () => {
    // Curve deployed a MetaRegistry on Ethereum only. Polygon is the trap: its
    // id 7 is an ACTIVE "Cryptopool Factory" that answers find_pool_for_coins
    // without reverting, so a wrong id reads as a working registry.
    expect(Object.keys(CURVE_METAREGISTRY_IDS).map(Number)).toEqual([1]);
  });

  it("never reintroduces a global default id", () => {
    for (const chainId of [10, 56, 100, 137, 8453, 42161, 43114, 534352]) {
      expect(CURVE_METAREGISTRY_IDS[chainId]).toBeUndefined();
    }
  });
});

describe("oracle provenance book (Morpho Blue §12 Q6)", () => {
  it("pins an oracle factory for every chain that has a Morpho singleton", () => {
    // A chain with markets but no factory pin cannot prove ANY oracle, so the
    // family silently goes dark there — the exact failure this rewrite fixed.
    const withMarkets = Object.keys(MORPHO_BLUE_SINGLETONS);
    const withFactory = new Set(Object.keys(MORPHO_CHAINLINK_ORACLE_FACTORIES));
    expect(withMarkets.filter((c) => !withFactory.has(c))).toEqual([]);
  });

  it("ships a non-empty reviewed feed list per factory chain", () => {
    // A factory with no feeds accepts nothing: the provenance check would pass
    // and every market would then fail `feed-not-reviewed`. That is fail-closed
    // but useless, and it is how the old per-market allowlist behaved.
    const bad = Object.keys(MORPHO_CHAINLINK_ORACLE_FACTORIES).filter(
      (chainId) => (CHAINLINK_FEEDS[Number(chainId)] ?? []).length === 0,
    );
    expect(bad).toEqual([]);
  });

  it("never lists the same feed address twice on one chain", () => {
    for (const [chainId, feeds] of Object.entries(CHAINLINK_FEEDS)) {
      const seen = feeds.map((f) => f.address.toLowerCase());
      expect(`${chainId}:${new Set(seen).size}`).toBe(
        `${chainId}:${seen.length}`,
      );
    }
  });

  it("gives every feed a describable pair and a positive heartbeat", () => {
    // `pair` is asserted against the feed's own `description()` by the drift
    // spec, and `heartbeatSec` is the denominator of the liveness bound — a
    // zero or missing one would make every feed look permanently fresh.
    const bad = Object.entries(CHAINLINK_FEEDS).flatMap(([chainId, feeds]) =>
      feeds
        .filter((f) => !f.pair.trim() || !(f.heartbeatSec > 0))
        .map((f) => `${chainId}:${f.address}`),
    );
    expect(bad).toEqual([]);
  });
});
