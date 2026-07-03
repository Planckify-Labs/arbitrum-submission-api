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

// ── Morpho MetaMorpho (api.morpho.org/graphql) ──────────────────────────────

interface MorphoVault {
  address: string;
  name: string | null;
  symbol: string | null;
  whitelisted?: boolean;
  asset: { address: string } | null;
}

const MORPHO_QUERY = `query Vaults($chainId: Int!) {
  vaults(first: 1000, where: { chainId_in: [$chainId] }) {
    items { address name symbol whitelisted asset { address } }
  }
}`;

async function fetchMorphoVaults(
  chainId: number,
  ctx: ResolverContext,
): Promise<MorphoVault[]> {
  const res = await ctx.fetchJsonCached<{
    data?: { vaults?: { items?: MorphoVault[] } };
  }>(
    `defillama:targets:morpho:vaults:${chainId}:v1`,
    "https://api.morpho.org/graphql",
    VAULT_LIST_TTL_SEC,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: MORPHO_QUERY, variables: { chainId } }),
    },
  );
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
        v.whitelisted !== false,
    );
    if (candidates.length === 0) return null;

    let match: MorphoVault | undefined;
    if (pool.poolMeta) {
      match = candidates.find((v) =>
        labelMatches(pool.poolMeta!, v.name, v.symbol),
      );
    }
    // No poolMeta (or no name hit): only accept a single unambiguous vault.
    if (!match && !pool.poolMeta && candidates.length === 1)
      match = candidates[0];
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

    let match: YearnVault | undefined;
    if (pool.poolMeta) {
      match = candidates.find((v) =>
        labelMatches(pool.poolMeta!, v.name, v.symbol),
      );
    }
    if (!match && !pool.poolMeta && candidates.length === 1)
      match = candidates[0];
    if (!match) return null;

    const target: DepositTarget = {
      kind: "erc4626",
      vault: match.address.toLowerCase() as Address,
      asset: underlying as Address,
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};
