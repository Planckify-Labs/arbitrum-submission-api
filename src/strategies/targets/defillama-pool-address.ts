/**
 * DeFiLlama pool UUID → on-chain address (spec §4, runbook §2).
 *
 * TWO sources live here, both keyed off a `/pools` UUID and both fail-closed:
 * `/poolsOld` (paywalled since 2026-08, kept for the pro-key path) and
 * `/poolsEnriched?pool=<uuid>` (free, reads the address out of the pool's own
 * deep link). See each export for its guards.
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

// ── The replacement: /poolsEnriched?pool=<uuid> → the `url` field ────────────

/**
 * `/poolsEnriched` is the free endpoint that survived, and it carries a field
 * `/pools` does not: `url`, the protocol's own deep link for that pool. For a
 * large slice of the catalog that link *contains the contract address*, which
 * is exactly the mapping `/poolsOld` used to provide.
 *
 *   yearn-finance   https://yearn.fi/v3/1/0xBe53A109…          → the vault
 *   euler-v2        https://app.euler.finance/earn/0x2C803c8C… → the EVault
 *   morpho-blue     https://app.morpho.org/base/vault/0xbeef0e… → the MetaMorpho vault
 *
 * Same trust level as `/poolsOld` and the same rules apply: it is a CANDIDATE,
 * never an authority, it may never become a `tx.to` for a singleton kind
 * (§12 Q7), and Layer-1 validation is what actually admits it.
 *
 * ## Two ways this could hand back a wrong address, and the guards
 *
 * 1. **A bytes32 that looks like an address.** Morpho's *market* links carry a
 *    32-byte market id, and a naive `0x[0-9a-fA-F]{40}` matches its first 40
 *    hex characters happily — producing a well-formed address that is not one.
 *    `ADDRESS_IN_URL` therefore requires hex boundaries on BOTH sides, so a
 *    64-hex id matches nothing at all rather than matching its own prefix.
 *    (Verified against a live market link, 2026-08-21.)
 * 2. **A link naming several contracts.** Which one is the vault is then a
 *    guess, so more than one distinct address is a refusal, not a first-wins.
 *
 * Links with no address (Spark, Concrete, Fluid, Venus, Vesper, Origin) simply
 * decline. That is the honest answer: those protocols need their own source.
 */
const POOLS_ENRICHED_URL = "https://yields.llama.fi/poolsEnriched";
const POOL_URL_TTL_SEC = 6 * 60 * 60; // a deep link changes far more slowly than an APY

/**
 * Hex boundaries on both sides. Without the lookahead a 32-byte id yields its
 * own first 40 hex characters as a plausible address — see guard 1 above.
 */
const ADDRESS_IN_URL = /(?<![0-9a-fA-F])(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/g;

interface PoolsEnrichedResponse {
  status?: string;
  data?: Array<{
    pool?: string;
    project?: string;
    chain?: string;
    url?: string;
  }>;
}

export async function poolUrlCandidate(
  pool: DeFiLlamaYieldPool,
  ctx: ResolverContext,
): Promise<Address | null> {
  if (!pool.pool) return null;
  const res = await ctx.fetchJsonCached<PoolsEnrichedResponse>(
    `defillama:targets:poolUrl:${pool.pool}:v1`,
    `${POOLS_ENRICHED_URL}?pool=${encodeURIComponent(pool.pool)}`,
    POOL_URL_TTL_SEC,
  );
  const row = res?.data?.[0];
  if (!row?.url) return null;

  // The response must be about the pool we asked for. Cheap, and it means a
  // mismatched or shifted response can never contribute an address.
  if (row.pool !== pool.pool) return null;
  if (row.project && pool.project && row.project !== pool.project) return null;
  if (row.chain && pool.chain && row.chain !== pool.chain) return null;

  const found = [
    ...new Set(
      [...row.url.matchAll(ADDRESS_IN_URL)].map((m) => m[1].toLowerCase()),
    ),
  ];
  // Zero → this protocol's link has no address. Several → which one is the
  // vault is a guess. Both are refusals (§8.2 "never guess").
  if (found.length !== 1) return null;

  const address = found[0] as Address;
  const underlying = pool.underlyingTokens?.[0]?.toLowerCase();
  if (underlying && underlying === address) return null;
  return address;
}

/**
 * Registered as a `"*"` fallback, after every protocol-specific source. It is
 * the generic path `/poolsOld` used to be, minus the paywall.
 */
export const PoolUrlCandidateSource: CandidateSource = {
  id: "defillama-pool-url",
  projects: "*",
  candidate: (pool, ctx) => poolUrlCandidate(pool, ctx),
};
