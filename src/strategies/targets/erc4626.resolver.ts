/**
 * ERC-4626 resolvers — Morpho MetaMorpho + Yearn v3 (spec §3.1, §5, §7.1).
 *
 * The whole ERC-4626 family (Morpho/Yearn/Euler/Gearbox…) maps to ONE mobile
 * adapter (`Erc4626Adapter`); a resolver's only job is to turn the DeFiLlama
 * pool's matching keys — `(underlyingTokens[0], poolMeta, chain)` — into the
 * concrete `{ kind: "erc4626", vault, asset }`. We match against the
 * protocol's own free HTTPS registry (Morpho blue-api / Yearn yDaemon), never
 * an SDK (spec §3.1 "prefer the plain HTTPS endpoint over the SDK").
 *
 * Fail closed: no confident match → `null` → the pool stays "manual".
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  Address,
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

const VAULT_LIST_TTL_SEC = 30 * 60; // matches the poll cadence

/** Normalise a vault/market label for fuzzy name matching (poolMeta ↔ name). */
function normLabel(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function labelMatches(
  poolMeta: string,
  ...candidates: (string | null | undefined)[]
): boolean {
  const needle = normLabel(poolMeta);
  if (!needle) return false;
  return candidates.some((c) => {
    const hay = normLabel(c);
    return hay.length > 0 && (hay.includes(needle) || needle.includes(hay));
  });
}

/**
 * Pick the one vault a pool names, or nothing.
 *
 * Two label sources, because DeFiLlama is inconsistent about where the vault
 * identity lives: for some protocols it is `poolMeta` ("Steakhouse USDC"), and
 * for Morpho it is `symbol` ("STEAKUSDC") with `poolMeta` null. Reading only
 * `poolMeta` meant every Morpho pool on Base fell into the ambiguous branch —
 * dozens of MetaMorpho vaults share USDC as their asset — and refused.
 *
 * The rules that keep this from becoming a guess:
 *   - a label must select EXACTLY ONE candidate; several hits is ambiguity, and
 *     ambiguity is a refusal, never "take the first one",
 *   - an explicit `poolMeta` that matches nothing is a mismatch signal, so we
 *     refuse rather than falling back to a lone candidate,
 *   - whatever is picked still has to pass `validateErc4626` on-chain, so a
 *     wrong label match cannot survive: the vault would report a different
 *     `asset()` and be rejected.
 */
function pickLabelledCandidate<T>(
  candidates: readonly T[],
  labels: readonly (string | null | undefined)[],
  labelsOf: (candidate: T) => (string | null | undefined)[],
): T | null {
  const [primary, ...rest] = labels;

  if (primary) {
    const hits = candidates.filter((c) =>
      labelMatches(primary, ...labelsOf(c)),
    );
    // An explicit primary label is a claim about identity: honour it or refuse.
    return hits.length === 1 ? hits[0] : null;
  }

  for (const label of rest) {
    if (!label) continue;
    const hits = candidates.filter((c) => labelMatches(label, ...labelsOf(c)));
    if (hits.length === 1) return hits[0];
  }

  // Nothing to disambiguate with, but only one thing it could be.
  return candidates.length === 1 ? candidates[0] : null;
}

// ── Morpho MetaMorpho (api.morpho.org/graphql) ──────────────────────────────

interface MorphoVault {
  address: string;
  name: string | null;
  symbol: string | null;
  listed?: boolean;
  asset: { address: string } | null;
}

/**
 * Morpho renamed `whitelisted` → `listed` on `Vault` (and the same rename plus
 * `uniqueKey` → `marketId` on `Market`). A rejected GraphQL query is HTTP 200
 * with `errors` and no `data`, so the old field name did not throw — it
 * returned zero vaults, and every MetaMorpho pool degraded to Manual with no
 * error anywhere. `external-api-drift.spec.ts` now fails on the next rename.
 */
const MORPHO_QUERY = `query Vaults($chainId: Int!) {
  vaults(first: 1000, where: { chainId_in: [$chainId] }) {
    items { address name symbol listed asset { address } }
  }
}`;

/** Exported so the drift spec asserts the EXACT query this resolver sends. */
export const MORPHO_VAULTS_QUERY = MORPHO_QUERY;

async function fetchMorphoVaults(
  chainId: number,
  ctx: ResolverContext,
): Promise<MorphoVault[]> {
  const res = await ctx.fetchJsonCached<{
    data?: { vaults?: { items?: MorphoVault[] } };
    errors?: Array<{ message?: string }>;
  }>(
    // v2: a cached v1 body was fetched with the old field names, so reusing the
    // key would keep serving an empty vault list for the whole TTL.
    `defillama:targets:morpho:vaults:${chainId}:v2`,
    "https://api.morpho.org/graphql",
    VAULT_LIST_TTL_SEC,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: MORPHO_QUERY, variables: { chainId } }),
    },
  );
  if (res?.errors?.length) {
    console.warn(
      `[morpho] vaults query rejected by api.morpho.org (schema drift?): ${res.errors
        .map((e) => e.message ?? "unknown")
        .join("; ")}`,
    );
    return [];
  }
  return res?.data?.vaults?.items ?? [];
}

export const MorphoResolver: PoolTargetResolver = {
  family: "morpho",
  aliases: [
    "morpho-blue",
    "morpho-aave-v3",
    "morpho-aavev2",
    "morpho",
    "morpho-vault",
  ],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;

    const vaults = await fetchMorphoVaults(chainId, ctx);
    const candidates = vaults.filter(
      (v) =>
        v.address &&
        v.asset?.address &&
        eqAddr(v.asset.address, underlying) &&
        v.listed !== false,
    );
    if (candidates.length === 0) return null;

    // Morpho pools carry the vault identity in `symbol` (STEAKUSDC) with
    // `poolMeta` null, so `symbol` is the fallback label here.
    const match = pickLabelledCandidate(
      candidates,
      [pool.poolMeta, pool.symbol],
      (v) => [v.name, v.symbol],
    );
    if (!match) return null;

    const target: DepositTarget = {
      kind: "erc4626",
      vault: match.address.toLowerCase() as Address,
      asset: (match.asset?.address ?? underlying).toLowerCase() as Address,
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};

// ── Yearn v3 (ydaemon.yearn.fi/{chainId}/vaults/all) ────────────────────────

interface YearnVault {
  address: string;
  name?: string;
  symbol?: string;
  kind?: string;
  version?: string;
  token?: { address?: string };
}

async function fetchYearnVaults(
  chainId: number,
  ctx: ResolverContext,
): Promise<YearnVault[]> {
  const res = await ctx.fetchJsonCached<YearnVault[]>(
    `defillama:targets:yearn:vaults:${chainId}:v1`,
    `https://ydaemon.yearn.fi/${chainId}/vaults/all`,
    VAULT_LIST_TTL_SEC,
  );
  return Array.isArray(res) ? res : [];
}

export const YearnResolver: PoolTargetResolver = {
  family: "yearn",
  aliases: ["yearn-finance", "yearn-v3", "yearn", "yearn-v2"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;

    const vaults = await fetchYearnVaults(chainId, ctx);
    // Prefer v3 (ERC-4626 compliant); v2 vaults are also 4626-shaped enough
    // for deposit(assets, receiver) but validation will confirm.
    const candidates = vaults.filter(
      (v) => v.address && eqAddr(v.token?.address, underlying),
    );
    if (candidates.length === 0) return null;

    const match = pickLabelledCandidate(
      candidates,
      [pool.poolMeta, pool.symbol],
      (v) => [v.name, v.symbol],
    );
    if (!match) return null;

    const target: DepositTarget = {
      kind: "erc4626",
      vault: match.address.toLowerCase() as Address,
      asset: underlying as Address,
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};
