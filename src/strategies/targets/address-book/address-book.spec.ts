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
  BALANCER_V2_CHAINS,
  BALANCER_V2_VAULT,
  BALANCER_V3_VAULTS,
  CURVE_ADDRESS_PROVIDER,
  PENDLE_ROUTER,
  SOLIDLY_DEPLOYMENTS,
  UNISWAP_V3_POSITION_MANAGERS,
  UNISWAP_V4_POSITION_MANAGERS,
} from "./dex";
import { AAVE_FORK_POOL_BOOKS, PINNED_VAULT_BOOKS } from "./index";
import { COMET_MARKETS, MORPHO_BLUE_SINGLETONS } from "./lending";
import { LST_VENUES } from "./lst";
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
        pins.push(
          pin(v.asset, Number(chainId), `asset:${owner}`, `${v.label} asset`),
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

  it("gives every LST venue a real chain", () => {
    const bad = LST_VENUES.filter(
      (v) => !Number.isInteger(v.chainId) || v.chainId <= 0,
    ).map((v) => v.key);
    expect(bad).toEqual([]);
  });
});
