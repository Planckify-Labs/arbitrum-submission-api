/**
 * Pool-target resolver registry (spec §5) — the backend twin of the mobile
 * adapter registry's space-docking. Resolvers register here; the score worker
 * calls `resolveTarget(pool)`. Adding a protocol is `registerResolver(...)`,
 * NEVER a `switch` on `pool.project`.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const resolvers: PoolTargetResolver[] = [];

export function registerResolver(resolver: PoolTargetResolver): void {
  // De-dupe by family so a double-bootstrap doesn't stack resolvers.
  const idx = resolvers.findIndex((r) => r.family === resolver.family);
  if (idx >= 0) resolvers[idx] = resolver;
  else resolvers.push(resolver);
}

export function listResolvers(): PoolTargetResolver[] {
  return [...resolvers];
}

/**
 * Every resolver that claims a DeFiLlama `project` slug, in the order they
 * should be TRIED. Empty → the pool degrades to the manual path
 * (correct-by-default for unregistered protocols).
 *
 * A slug can legitimately have several claimants, and the order between them is
 * a product decision: §12 Q3 wants a protocol's ERC-4626 wrapper tried BEFORE
 * its raw cToken market, because the wrapper reuses the hardened 4626
 * adapter/validator and the cToken path is the general fallback. Registration
 * order in `bootstrap.ts` expresses that.
 *
 * **Exact claimants exclude substring ones.** See the comment inline — this is
 * the rule that stops a savings product being resolved as a lending market.
 */
export function getResolversForProject(
  project: string | undefined,
): PoolTargetResolver[] {
  const needle = (project ?? "").toLowerCase();
  if (!needle) return [];

  const exact = resolvers.filter(
    (r) =>
      r.family.toLowerCase() === needle ||
      (r.aliases ?? []).some((a) => a.toLowerCase() === needle),
  );

  // An exact alias is a claim of OWNERSHIP over the slug. If the owner declines,
  // that is an answer — not an invitation for a look-alike to try.
  //
  // Substring matching used to run as a fallback even when an exact claimant
  // existed, and it routed real funds to the wrong product: `spark-savings`
  // (the sUSDS/sDAI ERC-4626 savings vaults) contains "spark", so
  // `SparkLendResolver` claimed it too. For USDC/USDT the savings resolver
  // correctly declined — only sUSDS and sDAI are pinned — and the ordered
  // fallback then handed the pool to SparkLend's LENDING Pool. A savings
  // deposit would have become a lending position: different product, different
  // risk, different APY.
  //
  // The device's Layer-1 `underlying-matches` check caught the USDC case, but
  // that was luck: for USDS — a reserve SparkLend does list — the underlying
  // would have MATCHED and nothing downstream would have objected.
  if (exact.length > 0) return exact;

  // Only when nobody claims the slug outright do we accept a substring match.
  // That is what lets "aave-v3-lido" reach the Aave resolver.
  const loose = resolvers.filter(
    (r) =>
      needle.includes(r.family.toLowerCase()) ||
      (r.aliases ?? []).some((a) => needle.includes(a.toLowerCase())),
  );
  if (loose.length > 0) recordSubstringMatch(needle, loose);
  return loose;
}

// ── Substring-match surveillance ────────────────────────────────────────────
//
// This fallback has mis-routed funds TWICE, and both times it validated cleanly
// so nothing downstream objected:
//
//   `spark-savings`  → SparkLend's lending Pool (savings deposit became a
//                      lending position; see the comment above)
//   `aave-v4`        → the Aave v3 Pool (wstETH/WBTC/weETH are real v3
//                      reserves, so Layer-1 passed; ~$168M across 5 pools)
//
// The pattern is always the same: a protocol ships a new version or a variant
// whose slug CONTAINS an existing family's name, nobody claims it exactly, and
// the look-alike answers. It will happen again — `compound-v4`, `uniswap-v5`,
// `morpho-v2` are all one DeFiLlama listing away.
//
// So rather than wait to be surprised a third time, every use of the fallback
// is recorded. The dry run prints them, which turns "a slug we never reviewed
// reached a resolver" from something you discover into something you are told.
// The fix for any entry that appears here is a `reserved` manifest entry
// (protocols.ts) or a real alias — an exact claimant beats a substring one.

const substringMatches = new Map<string, Set<string>>();

function recordSubstringMatch(
  slug: string,
  matched: readonly PoolTargetResolver[],
): void {
  const families = substringMatches.get(slug) ?? new Set<string>();
  for (const r of matched) families.add(r.family);
  substringMatches.set(slug, families);
}

export interface SubstringMatch {
  /** The DeFiLlama slug nobody claimed outright. */
  readonly slug: string;
  /** Families that answered anyway, by containing part of the slug. */
  readonly families: readonly string[];
}

/**
 * Every slug that reached a resolver ONLY by substring. Each one is a protocol
 * nobody reviewed being served by a family that merely looks like it.
 */
export function substringMatchReport(): readonly SubstringMatch[] {
  return [...substringMatches.entries()]
    .map(([slug, families]) => ({ slug, families: [...families].sort() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Test seam. */
export function resetSubstringMatches(): void {
  substringMatches.clear();
}

/**
 * The first resolver that claims a slug. Kept for callers that only need to ask
 * "is this protocol registered at all"; resolution itself goes through
 * `resolveTarget`, which tries every claimant.
 */
export function getResolverForProject(
  project: string | undefined,
): PoolTargetResolver | null {
  return getResolversForProject(project)[0] ?? null;
}

/**
 * Try each claimant in order and take the first CONFIDENT answer. A resolver
 * returning `null` means "not mine / cannot confirm", which is exactly the
 * signal to fall through to the next one — and if none of them can resolve,
 * the pool keeps its honest Manual badge (§8.2).
 *
 * A resolver that throws is treated as `null` for the same reason: one
 * protocol's flaky API must not deny the pool a resolver that would have
 * worked.
 */
export async function resolveTarget(
  pool: DeFiLlamaYieldPool,
  ctx: ResolverContext,
): Promise<DepositTarget | null> {
  for (const resolver of getResolversForProject(pool.project)) {
    const target = await resolver.resolve(pool, ctx).catch(() => null);
    if (target) return target;
  }
  return null;
}
