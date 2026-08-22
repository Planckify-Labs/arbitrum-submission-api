/**
 * Resolver bootstrap (pool-level spec §5.1, expansion spec §8.6).
 *
 * Registration order is load-bearing in one place only: §12 Q3 wants a
 * protocol's ERC-4626 wrapper tried before its raw cToken, so `venus-4626`
 * registers ahead of `venus`. Everything else is order-independent — the
 * registry routes by `family`/`aliases`, never by position.
 *
 * Adding a protocol is one `registerResolver(...)` here plus its one-file
 * resolver. No branch anywhere.
 *
 * **Tier flags default OFF** (see feature-flags.ts): a family goes live only
 * once its Layer-1 validator, Layer-4 decode assertion and Layer-5 pause check
 * are fork-tested (§11.3) and its pinned addresses have security sign-off
 * (§12 Q7). The flags gate BOTH sides — the mobile adapter registration is
 * gated by the twin flags in `mobile-app/constants/configs/featureFlags.ts`, so
 * a half-wired family never badges "Deposit in-app".
 */

import { TIER1_AAVE_FORK_RESOLVERS } from "./aave-fork.resolver";
import { AaveResolver } from "./aave.resolver";
import { TIER3_BALANCER_RESOLVERS } from "./balancer.resolver";
import { ONCHAIN_CANDIDATE_SOURCES } from "./candidates/onchain.source";
import { registerCandidateSource } from "./candidates/registry";
import { TIER2_COMPOUND_RESOLVERS } from "./compound.resolver";
import { CurveResolver } from "./curve.resolver";
import {
  PoolUrlCandidateSource,
  PoolsOldCandidateSource,
} from "./defillama-pool-address";
import { EmberResolver } from "./ember.resolver";
import { TIER1_ERC4626_RESOLVERS } from "./erc4626-family.resolver";
import { MorphoResolver, YearnResolver } from "./erc4626.resolver";
import { familyEnabled, isFamilyKilled } from "./feature-flags";
import { LstStakeResolver } from "./lst.resolver";
import { MorphoBlueResolver } from "./morpho-blue.resolver";
import { NaviResolver } from "./navi.resolver";
import { bootProtocolManifests } from "./protocol-manifest";
import "./protocols";
import { registerResolver } from "./registry";
import { TIER3_ROUTER_CALL_RESOLVERS } from "./router-call.resolver";
import { ScallopResolver } from "./scallop.resolver";
import { TIER3_SOLIDLY_RESOLVERS } from "./solidly.resolver";
import { SuiLstResolver } from "./suilst.resolver";
import type { PoolTargetResolver } from "./types";
import { TIER3_UNISWAP_V2_RESOLVERS } from "./uniswap-v2.resolver";
// SuilendResolver is implemented but NOT registered: Suilend's deposit AND
// withdraw both assert a fresh reserve price (abort code 1), which needs a Pyth
// pull-oracle push in-tx — deferred (see suilend.resolver.ts / suilendSui.ts).
// Registering it would badge Suilend "in-app" and then intermittently fail.

let booted = false;

/**
 * Candidate-address sources (spec §4, §12 Q1).
 *
 * Order is load-bearing: a protocol's OWN on-chain registry is consulted before
 * the generic DeFiLlama fallback, so the answer comes from the deployment
 * rather than from an aggregator that can be paywalled — which is exactly what
 * happened to `/poolsOld`, silently disabling seven families at once.
 *
 * NOT gated by the tier flags. A candidate source cannot route funds anywhere
 * on its own: the resolver's validator still has to prove the address, and a
 * wrong candidate fails closed to Manual. Gating discovery would only make the
 * dry run lie about what a tier would resolve.
 */
function bootCandidateSources(): void {
  for (const source of ONCHAIN_CANDIDATE_SOURCES) {
    registerCandidateSource(source);
  }
  // `/poolsOld` is registered ONLY with a pro key. Without one it is HTTP 402
  // (verified 2026-08-19), and a source we know answers nothing does not belong
  // in the fallback chain: it would sit there looking like coverage, which is
  // precisely the failure mode the discovery-health check exists to catch.
  if (process.env.DEFILLAMA_PRO_API_KEY?.trim()) {
    registerCandidateSource(PoolsOldCandidateSource);
  }
  // The free replacement. Last, so a protocol's own registry always wins over
  // an aggregator's deep link.
  registerCandidateSource(PoolUrlCandidateSource);
}

/**
 * Register a family only when its tier flag AND its own sub-flag are on, and
 * ops has not tripped the kill-switch for it. One helper so every expansion
 * family is gated identically — a family that forgets its gate is the exact
 * mistake §11.3 forbids.
 */
function registerGated(
  tier: "tier1" | "tier2" | "tier3" | "tier4",
  resolvers: readonly PoolTargetResolver[],
): void {
  for (const resolver of resolvers) {
    if (!familyEnabled(tier, resolver.family)) continue;
    if (isFamilyKilled(resolver.family)) continue;
    registerResolver(resolver);
  }
}

export function bootTargetResolvers(): void {
  if (booted) return;
  bootCandidateSources();
  registerResolver(MorphoResolver);
  registerResolver(YearnResolver);
  registerResolver(AaveResolver);
  // Sui — Ember Vaults (generic tokenized-vault family; multi-vault, so the
  // resolver disambiguates siblings by poolMeta ↔ vault name). Emits
  // `{ kind: "ember-vault" }` for the mobile EmberSuiAdapter (Phase 3).
  registerResolver(EmberResolver);
  // Sui — Scallop (single-market-per-asset). Emits `{ kind: "scallop-market" }`
  // for the existing ScallopSuiAdapter, so scallop-lend pools badge "Deposit
  // in-app" instead of resolving to nothing (Phase 3).
  registerResolver(ScallopResolver);
  // Sui — NAVI (single-market-per-asset, coinType-matched via its pools API).
  // Emits `{ kind: "navi-pool" }` for the mobile NaviSuiAdapter (Phase 3).
  registerResolver(NaviResolver);
  // Sui — liquid staking (Haedal / Volo / SpringSui / Aftermath). Emits
  // `{ kind: "sui-lst" }` for the mobile SuiLstAdapter. The pools these match
  // are synthesized by `SuiLstSource` (absent from DeFiLlama's Sui feed).
  registerResolver(SuiLstResolver);
  // Suilend NOT registered — its deposit + withdraw are both Pyth-gated (see the
  // import note). The resolver + mobile adapter are ready; wire the Pyth push
  // then register here.

  // ── Tier 1 — widen the existing funnels. No new adapter, no new kind. ────
  // Family A (ERC-4626) first so a protocol that ships BOTH a 4626 wrapper and
  // a raw cToken market resolves through the hardened 4626 path (§12 Q3).
  registerGated("tier1", TIER1_ERC4626_RESOLVERS);
  // Family B (Aave-v3 forks) — resolver only, reuses the Aave adapter.
  registerGated("tier1", TIER1_AAVE_FORK_RESOLVERS);

  // ── Tier 2 — the declared-but-empty kinds get their adapters. ────────────
  registerGated("tier2", TIER2_COMPOUND_RESOLVERS);
  registerGated("tier2", [MorphoBlueResolver]);
  registerGated("tier2", [CurveResolver]);

  // ── Tier 3 — bespoke families. ──────────────────────────────────────────
  // Pendle only. The Uniswap v3/v4 resolvers exist and validate, but the
  // router-quote proxy has no Uniswap encoder: a concentrated-liquidity
  // position needs a tick range, which is a different product decision from
  // "supply this asset", and a guessed default range is a real position with
  // real losses. Registering them would badge pools the app cannot execute.
  registerGated(
    "tier3",
    TIER3_ROUTER_CALL_RESOLVERS.filter((r) => r.family === "pendle"),
  );
  registerGated("tier3", TIER3_SOLIDLY_RESOLVERS);
  registerGated("tier3", TIER3_UNISWAP_V2_RESOLVERS);
  registerGated("tier3", [LstStakeResolver]);
  // Balancer v2 / Beets — `BalancerQueries` is now pinned per chain
  // (address-book/dex.ts, verified against `balancer/balancer-deployments`,
  // 2026-08-19), so both sides can price `minimumBPT`/`minAmountsOut` instead
  // of guessing (§12 Q4 forbids a zero minimum). Each resolver still carries
  // its own `FEATURE_DEFI_EVM_FAMILY_BALANCER` / `_BEETS` sub-flag via
  // `registerGated`. This resolver accepts v2- AND v3-vault pools by identity
  // (a real v3 pool has no `getPoolId()` and never reaches here — see the
  // resolver's own comment); the mobile `BalancerLpAdapter` additionally
  // refuses to BUILD for anything but the pinned v2 Vault, so a v3 target
  // (if one ever slipped through) fails closed on-device rather than badging
  // "Deposit in-app" for a call nothing can make. v3 Router-based join/exit is
  // separate, larger work — not attempted here.
  registerGated("tier3", TIER3_BALANCER_RESOLVERS);

  // ── The protocol catalogue (protocols.ts) ────────────────────────────────
  // One entry per protocol, gating derived from the entry. Registered last so
  // a manifest never shadows a bespoke resolver that claims the same slug —
  // the registry tries claimants in order, and the hand-written one wins.
  //
  // A manifest's own API source registers here too, which is why it lands
  // AFTER the on-chain sources (chain state outranks an endpoint) and BEFORE
  // `/poolsOld` in practice: sources are consulted in registration order.
  bootProtocolManifests();

  // ── Tier 4 — ERC-7540 async vaults. Deliberately NO resolver. ────────────
  // §7 is explicit: do not register an `async-vault` resolver until the
  // two-phase request/claim interface ships. Badging an async pool "Deposit
  // in-app" before then produces a deposit that requests and then appears
  // stuck. The kind, its validator and the adapter's optional two-phase
  // methods all exist; only the resolver is withheld.
  //
  // Convex / Aura (§6.3) are withheld for the same reason: boosting is a
  // two-leg flow (acquire the Curve/Balancer LP, then stake it) that
  // `UnsignedCall`'s one-shot model cannot express, and §8.1 assigns them no
  // validator. They ship on the Tier-4 two-phase machinery, not before.

  booted = true;
}

/** Test seam — lets a spec re-run bootstrap with different flags. */
export function resetTargetResolverBootstrap(): void {
  booted = false;
}
