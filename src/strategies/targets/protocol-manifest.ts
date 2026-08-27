/**
 * One protocol, one entry (spec §11.6, §12 Q7, runbook §11.2).
 *
 * ## Why this exists
 *
 * Onboarding a protocol used to mean reasoning about four separate mechanisms
 * in four files — a resolver factory, an address book, a candidate source, and
 * a bootstrap registration — and deciding which of them applied. Nothing
 * checked that you did all the right ones, which is how §11.3's "a family that
 * forgets its gate is the exact mistake" became a warning worth writing down.
 *
 * A manifest collapses that into a declaration of the only two things that
 * actually vary between protocols:
 *
 *   **execution** — how a deposit is built (picks the adapter, the validator,
 *                   the Layer-4 decode case and the Layer-5 pause read)
 *   **discovery** — where the contract address comes from
 *
 * Those two axes are deliberately separate, and keeping them separate is the
 * property worth protecting: when `/poolsOld` went to HTTP 402 we replaced the
 * discovery of an entire family without touching how it executes. A design that
 * fused them would have made that a rewrite.
 *
 * ## Scope: EVM only, on purpose
 *
 * Every `execution.kind` here names an EVM adapter, and the discovery layer
 * returns `Address` (`0x${string}`) — which a Sui object id or a Solana pubkey
 * is not. Declaring a non-EVM protocol here would resolve nothing, silently.
 * `protocol-manifest.spec.ts` fails on a kind that is not an EVM target kind,
 * and `protocolApiSource` warns by name if a non-EVM chain reaches it.
 *
 * Non-EVM protocols resolve today through their own resolvers (scallop, navi,
 * ember, suilst), which call the protocol's API directly and never touch the
 * candidate layer. They work; they just do not get the manifest's ergonomics.
 *
 * **Docking a namespace** (the space-docking rule) means widening the candidate
 * identifier to a namespace-neutral string and letting each resolver narrow it
 * to its own shape — never adding a `namespace === "sui"` branch. Worth doing
 * when the second namespace actually arrives, and not before: an abstraction
 * shaped by one example is the wrong abstraction.
 *
 * The safety layer already docks correctly and is the reference: a chain
 * implements `ChainSafetyProvider` and optional capabilities like
 * `readExitTerms?` are presence-checked (§11.4). One correction to what this
 * comment used to claim: a namespace with no provider does NOT no-op — Layer
 * 1's `target-has-code` refuses it outright with `unsupported_chain`, which is
 * the §11.3 posture (a chain we cannot verify is Manual-only, never "in-app").
 * Presence-checking applies to a docked provider's OPTIONAL capabilities, not
 * to the provider itself.
 *
 * ## What this is NOT
 *
 * Not a replacement for `registerResolver`. Protocols whose *identity* is
 * bespoke keep their own resolver and should: Morpho Blue re-derives
 * `keccak256(abi.encode(params))`, Balancer probes `getPoolId()` to tell a v2
 * pool from a v3 one, Curve reads `coins[]` arity. Forcing those through a
 * declarative shape would turn this into a leaky config language, which ages
 * worse than the code it replaced. This covers the common path; the escape
 * hatch stays open.
 */

import type {
  ProtocolApiAddressSpec,
  ProtocolApiSpec,
} from "./candidates/protocol-api.source";
import {
  protocolApiSource,
  protocolApiVaultSource,
} from "./candidates/protocol-api.source";
import type { CandidateSource } from "./candidates/registry";
import { registerCandidateSource } from "./candidates/registry";
import {
  TIER2_COMPOUND_RESOLVERS,
  cTokenForkResolver,
} from "./compound.resolver";
import {
  discoveredVaultResolver,
  pinnedVaultResolver,
} from "./erc4626-family.resolver";
import { familyEnabled, isFamilyKilled } from "./feature-flags";
import { registerResolver } from "./registry";
import type { PoolTargetResolver } from "./types";

export type ProtocolTier = "tier1" | "tier2" | "tier3" | "tier4";

/**
 * How a deposit is executed. The `kind` selects an already-shipped adapter and
 * validator, which is why adding a protocol here can never introduce an
 * unvalidated execution path: `validateTarget` has no `default: return true`
 * for EVM kinds, so a kind without a validator is rejected rather than trusted.
 */
export type ExecutionSpec =
  /** ERC-4626 vaults, discovered per market. Routes to `Erc4626Adapter`. */
  | { kind: "erc4626" }
  /**
   * ERC-4626 vaults whose addresses are PINNED rather than discovered. The
   * book key lives in `PINNED_VAULT_BOOKS`; no discovery is consulted at all,
   * which is the strongest form and the right one for a protocol with a small,
   * stable set of vaults.
   */
  | { kind: "erc4626-pinned"; book: string }
  /** Compound-v2 cToken forks. Routes to `CompoundV2Adapter`. */
  | { kind: "compound-v2" }
  /**
   * The protocol's identity is bespoke and its resolver is registered
   * elsewhere (Pendle's router-call, Balancer's `getPoolId()` probe). The
   * manifest then declares DISCOVERY ONLY, so a protocol whose execution
   * cannot be declarative still has one place that says where its address
   * comes from.
   */
  | { kind: "bespoke"; resolvedBy: string }
  /**
   * The slug is CLAIMED so nothing else can have it, and always refuses.
   *
   * The registry falls back to substring matching when no resolver claims a
   * slug outright, which is what lets "aave-v3-lido" reach the Aave resolver.
   * The same rule mis-fires on a NEWER version with a different interface:
   * "aave-v4" contains "aave", so Aave v4 pools resolved against the v3 Pool
   * and validated cleanly, because wstETH really is a listed v3 reserve. The
   * user would have seen v4 and deposited into v3.
   *
   * An exact claimant beats a substring one, so reserving the slug is the fix
   * that uses the existing rule rather than special-casing it.
   */
  | { kind: "reserved"; reason: string };

/**
 * Where the address comes from. `pinned` execution needs none; everything else
 * must say, because "we did not think about it" and "the aggregator will
 * handle it" are the same bug and that bug already cost us seven families.
 */
export type DiscoverySpec =
  /** A source registered elsewhere (an on-chain registry, a protocol API). */
  | { via: "registered-source"; sourceId: string }
  /** This manifest brings its own source. */
  | { via: "source"; source: CandidateSource }
  /** The protocol's own API — the common case (§11.6). */
  | ({ via: "protocol-api" } & Omit<ProtocolApiSpec, "family" | "projects">)
  /**
   * The protocol's own API, when it lists vault ADDRESSES but not their
   * assets. `asset`/`symbol`/`name` are then read on chain. Use this whenever
   * the payload has no asset field — the alternative is inferring one, and an
   * inferred asset is exactly the kind of guess §8.2 forbids.
   */
  | ({ via: "protocol-api-addresses" } & Omit<
      ProtocolApiAddressSpec,
      "family" | "projects"
    >);

export interface ProtocolManifest {
  /** Canonical family name. Also the feature-flag key and the log label. */
  readonly slug: string;
  /** DeFiLlama `project` slugs this protocol appears under. */
  readonly aliases: readonly string[];
  readonly tier: ProtocolTier;
  readonly execution: ExecutionSpec;
  readonly discovery?: DiscoverySpec;
  /** RPC-budget pre-filter, never a safety control. */
  readonly minTvlUsd?: number;
  /**
   * Why this protocol is not registered yet. Present ⇒ it is skipped, and the
   * reason is readable in code instead of being an absence someone has to
   * notice. Mirrors how the withheld families are documented in §11.3.
   */
  readonly withheld?: string;
}

const manifests: ProtocolManifest[] = [];

function sourceFor(m: ProtocolManifest): CandidateSource | null {
  const d = m.discovery;
  if (!d) return null;
  if (d.via === "source") return d.source;
  if (d.via === "protocol-api")
    return protocolApiSource({
      family: m.slug,
      projects: m.aliases,
      url: d.url,
      init: d.init,
      rows: d.rows,
    });
  if (d.via === "protocol-api-addresses")
    return protocolApiVaultSource({
      family: m.slug,
      projects: m.aliases,
      url: d.url,
      init: d.init,
      addresses: d.addresses,
    });
  return null; // "registered-source" is wired by whoever owns it
}

function resolverFor(m: ProtocolManifest): PoolTargetResolver | null {
  switch (m.execution.kind) {
    case "bespoke":
      return null;
    case "reserved": {
      const { reason } = m.execution;
      return {
        family: m.slug,
        aliases: m.aliases,
        async resolve() {
          // Claims the slug, resolves nothing. Manual is the correct output.
          void reason;
          return null;
        },
      };
    }
    case "erc4626":
      return discoveredVaultResolver({
        family: m.slug,
        aliases: m.aliases,
        minTvlUsd: m.minTvlUsd,
      });
    case "erc4626-pinned":
      return pinnedVaultResolver({
        family: m.slug,
        aliases: m.aliases,
        book: m.execution.book,
      });
    case "compound-v2":
      return cTokenForkResolver({
        family: m.slug,
        aliases: m.aliases,
        minTvlUsd: m.minTvlUsd,
      });
  }
}

/**
 * Declare a protocol. Registration is deferred to `bootProtocolManifests()` so
 * the manifest list can be inspected by tests and by the dry run WITHOUT
 * booting the registry — the conformance spec needs to see entries that are
 * withheld or whose flag is off, which a register-on-call design would hide.
 */
export function registerProtocol(manifest: ProtocolManifest): void {
  if (manifests.some((m) => m.slug === manifest.slug)) {
    throw new Error(`[protocol-manifest] duplicate slug "${manifest.slug}"`);
  }
  manifests.push(manifest);
}

/** Every declared protocol, registered or not. For tests and diagnostics. */
export function allProtocolManifests(): readonly ProtocolManifest[] {
  return manifests;
}

/**
 * Register every manifest whose tier flag, family sub-flag and kill-switch all
 * allow it. Gating is DERIVED from the slug rather than hand-wired, so a
 * manifest cannot ship ungated — that is the §11.3 mistake made structurally
 * impossible instead of documented.
 */
export function bootProtocolManifests(): void {
  for (const m of manifests) {
    if (m.withheld) continue;
    if (!familyEnabled(m.tier, m.slug)) continue;
    if (isFamilyKilled(m.slug)) continue;

    const source = sourceFor(m);
    if (source) registerCandidateSource(source);
    const resolver = resolverFor(m);
    if (resolver) registerResolver(resolver);
  }
}

/** Test seam. */
export function resetProtocolManifests(): void {
  manifests.length = 0;
}

/** Kinds already covered by a shipped resolver elsewhere, for the conformance spec. */
export const LEGACY_COMPOUND_RESOLVERS = TIER2_COMPOUND_RESOLVERS;
