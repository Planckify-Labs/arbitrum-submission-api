/**
 * DeFiLlama pool UUID → on-chain address (spec §4, runbook §2).
 *
 * A `/pools` `pool` id is an opaque UUID, which is why resolving a target
 * normally means fetching the protocol's OWN vault registry and matching on
 * `(underlying, poolMeta)`. That works, but it needs a bespoke API client per
 * protocol — and most of the Family-A catalog (Euler, Fluid, Gearbox,
 * Concrete, Venus wrappers) has no registry we can stand behind.
 *
 * DeFiLlama also publishes the pre-UUID identifiers at `/poolsOld`, where
 * `pool_old` is usually `"<address>-<chain>"` — the contract the protocol's
 * yield-server adaptor indexed. That gives a **protocol-agnostic candidate
 * address** for any pool, which is exactly what the ERC-4626 funnel needs:
 * §12 Q1 decided a Family-A candidate is admitted *iff* `validateErc4626`
 * passes, so the resolver only has to produce a candidate and the on-chain
 * proof does the rest.
 *
 * This is a CANDIDATE source, never an authority:
 *   - `pool_old` is not always an address (many adaptors use a slug) → null.
 *   - For non-4626 families the address is the wrong contract (Aave's aToken,
 *     Curve's LP token) — which is why every caller still runs its kind's
 *     validator, and a wrong candidate fails closed to Manual rather than
 *     routing funds (§8.2).
 *   - It is a third-party response, so it may never become a `tx.to` for a
 *     singleton kind (§12 Q7); it only ever supplies per-vault addresses that
 *     Layer-1 identity then has to prove.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type { CandidateSource } from "./candidates/registry";
import type { Address, ResolverContext } from "./types";

const POOLS_OLD_URL = "https://yields.llama.fi/poolsOld";
const POOLS_OLD_TTL_SEC = 6 * 60 * 60; // slow-moving; the ids are stable
const CACHE_KEY = "defillama:targets:poolsOld:v1";

interface PoolsOldResponse {
  status?: string;
  data?: Array<{ pool?: string; pool_old?: string }>;
}

const ADDRESS_IN_ID = /(0x[0-9a-fA-F]{40})/;

/** Index is built once per cache window and reused across pools in a poll. */
let index: Map<string, string> | null = null;
let indexBuiltFrom: unknown = null;

function buildIndex(rows: PoolsOldResponse["data"]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    if (typeof row?.pool === "string" && typeof row?.pool_old === "string") {
      map.set(row.pool, row.pool_old);
    }
  }
  return map;
}

/**
 * `/poolsOld` moved behind DeFiLlama's paid plan (HTTP 402, "Upgrade to the
 * paid API plan"); the free `/pools` feed is unaffected. This is the ONLY
 * protocol-agnostic candidate-address source we have, so without it every
 * discovered-vault family (Euler, Fluid, Gearbox, Concrete, Venus-4626) plus
 * the Pendle / Solidly / Balancer / cToken resolvers find no candidate and
 * degrade to Manual.
 *
 * `DEFILLAMA_PRO_API_KEY` switches to the pro host. Env because it is a
 * credential, and safe as env because the URL it builds is a *data source*,
 * never a `tx.to` — the same distinction the address book draws.
 */
function poolsOldUrl(): string {
  const key = process.env.DEFILLAMA_PRO_API_KEY?.trim();
  return key
    ? `https://pro-api.llama.fi/${key}/yields/poolsOld`
    : POOLS_OLD_URL;
}

/** Warn once per process, not once per pool — this runs inside a scoring loop. */
let warnedUnavailable = false;

/**
 * The legacy identifier for a pool UUID, or null when DeFiLlama has none.
 */
async function poolOldId(
  poolId: string,
  ctx: ResolverContext,
): Promise<string | null> {
  const res = await ctx.fetchJsonCached<PoolsOldResponse>(
    // Keyed by whether a pro key is configured, so adding one does not keep
    // serving the empty result cached during the paywalled window.
    process.env.DEFILLAMA_PRO_API_KEY ? `${CACHE_KEY}:pro` : CACHE_KEY,
    poolsOldUrl(),
    POOLS_OLD_TTL_SEC,
  );
  if (!res?.data) {
    // Fail-closed is right; failing closed SILENTLY is what let the Morpho
    // schema rename go unnoticed. Say it once, loudly.
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn(
        "[defillama] /poolsOld returned no data (paywalled or down). Every family that needs " +
          "a candidate vault address will resolve to Manual. Set DEFILLAMA_PRO_API_KEY, or " +
          "replace this source with per-protocol registries.",
      );
    }
    return null;
  }
  if (index === null || indexBuiltFrom !== res.data) {
    index = buildIndex(res.data);
    indexBuiltFrom = res.data;
  }
  return index.get(poolId) ?? null;
}

/**
 * The generic, protocol-agnostic candidate source — registered as the `"*"`
 * fallback so it runs only after every protocol-specific on-chain source has
 * declined (see ../candidates/registry.ts).
 *
 * It used to be the ONLY source, which is how DeFiLlama paywalling `/poolsOld`
 * managed to silently disable seven resolver families at once.
 */
export const PoolsOldCandidateSource: CandidateSource = {
  id: "defillama-pools-old",
  projects: "*",
  candidate: (pool, ctx) => poolsOldCandidate(pool, ctx),
};

/**
 * Best-effort candidate contract address for a pool. Returns null whenever the
 * legacy id is a slug rather than an address — the caller then has no candidate
 * and degrades to Manual.
 */
export async function poolsOldCandidate(
  pool: DeFiLlamaYieldPool,
  ctx: ResolverContext,
): Promise<Address | null> {
  const legacy = await poolOldId(pool.pool, ctx);
  if (!legacy) return null;
  const match = ADDRESS_IN_ID.exec(legacy);
  if (!match) return null;
  const address = match[1].toLowerCase() as Address;
  // A candidate that is just the deposited token is never a vault; reject it
  // early so the validator isn't asked a question with an obvious answer.
  const underlying = pool.underlyingTokens?.[0]?.toLowerCase();
  if (underlying && underlying === address) return null;
  return address;
}

/** Test seam — drops the memoised index between fixtures. */
export function resetPoolAddressIndex(): void {
  index = null;
  indexBuiltFrom = null;
}
