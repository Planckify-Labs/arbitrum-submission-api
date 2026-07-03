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
 * Find the resolver for a DeFiLlama `project` slug: exact family/alias match
 * first, then a fuzzy family-substring fallback (so "morpho-blue-something"
 * still routes to the morpho resolver). Returns null → the pool degrades to
 * the manual path (correct-by-default for unregistered protocols).
 */
export function getResolverForProject(
  project: string | undefined,
): PoolTargetResolver | null {
  const needle = (project ?? "").toLowerCase();
  if (!needle) return null;
  const exact = resolvers.find(
    (r) =>
      r.family.toLowerCase() === needle ||
      (r.aliases ?? []).some((a) => a.toLowerCase() === needle),
  );
  if (exact) return exact;
  return (
    resolvers.find(
      (r) =>
        needle.includes(r.family.toLowerCase()) ||
        (r.aliases ?? []).some((a) => needle.includes(a.toLowerCase())),
    ) ?? null
  );
}

export async function resolveTarget(
  pool: DeFiLlamaYieldPool,
  ctx: ResolverContext,
): Promise<DepositTarget | null> {
  const resolver = getResolverForProject(pool.project);
  if (!resolver) return null;
  return await resolver.resolve(pool, ctx);
}
