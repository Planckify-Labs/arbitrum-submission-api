/**
 * Shared Valkey cache keys for the pool-level deposit path (spec §11 Q4).
 * The full OpportunityCache row is cached by poolId so the executor's
 * authoritative `depositTarget` re-fetch (§6) is served from Valkey, not the
 * DB, on the hot path. The score worker invalidates it on upsert.
 */
export function oppRowCacheKey(poolId: string): string {
  return `strategies:opp:pool:${poolId}:v1`;
}

/** How long a cached opportunity row lives — short, since the poll refreshes it. */
export const OPP_ROW_CACHE_TTL_SEC = 5 * 60;
