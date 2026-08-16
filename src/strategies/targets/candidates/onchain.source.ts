/**
 * Candidate sources that read a protocol's OWN on-chain registry.
 *
 * These are the replacement for DeFiLlama `/poolsOld` and they are better than
 * what they replace, not merely a substitute:
 *
 *   - nobody can paywall a contract read,
 *   - the answer cannot be stale, because it IS the deployment,
 *   - it is the same trust model as the validator that runs immediately after,
 *     so the candidate and its proof come from the same place.
 *
 * Every entry point below was verified against mainnet before it was written
 * here (`GenericFactory.getProxyListLength()` → 877, `getAllFTokens()` → 7,
 * `AddressProvider.get_address(7)` → MetaRegistry, `find_pool_for_coins(DAI,
 * USDC)` → 3pool). Nothing here is a guessed ABI.
 *
 * The one address each source needs is PINNED in the address book, because a
 * registry contract is a singleton and §12 Q7 applies to it exactly as it does
 * to a Pool: the registry decides which vault we route into, so an attacker who
 * could swap the registry could swap the destination.
 */

import type { DeFiLlamaYieldPool } from "../../external/defillama.client";
import {
  CURVE_ADDRESS_PROVIDER,
  CURVE_METAREGISTRY_ID,
  EULER_VAULT_FACTORIES,
  FLUID_LENDING_RESOLVERS,
  MULTICALL3,
  solidlyDeployment,
} from "../address-book";
import type { Address, EvmReadClient, ResolverContext } from "../types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "../types";
import { type CandidateSource, pickUniqueByLabel } from "./registry";

const ERC4626_ABI = [
  {
    name: "asset",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const FACTORY_ABI = [
  {
    name: "getProxyListLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getProxyListSlice",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
] as const;

const FLUID_ABI = [
  {
    name: "getAllFTokens",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
] as const;

const CURVE_ABI = [
  {
    name: "get_address",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "find_pool_for_coins",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;

const SOLIDLY_FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "bool" }],
    outputs: [{ type: "address" }],
  },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Vault enumeration is expensive (Euler lists ~900), so a chain's list is
 * memoised for the poll window. Keyed by `(source, chainId)`.
 */
interface VaultRow {
  address: Address;
  asset: Address;
  symbol: string | null;
  name: string | null;
}
const vaultCache = new Map<string, { at: number; rows: VaultRow[] }>();
const VAULT_TTL_MS = 30 * 60 * 1000;

async function read<T>(
  client: EvmReadClient,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T | null> {
  try {
    return (await client.readContract({
      address,
      abi,
      functionName,
      args,
    })) as T;
  } catch {
    return null;
  }
}

/**
 * Read `asset`/`symbol`/`name` for a list of vaults, batched when the client
 * supports it. Vaults whose reads fail are dropped rather than defaulted — a
 * contract that will not say what its asset is has not identified itself.
 */
async function describeVaults(
  client: EvmReadClient,
  addresses: readonly Address[],
): Promise<VaultRow[]> {
  const rows: VaultRow[] = [];

  if (typeof client.multicall === "function") {
    const results = await client.multicall({
      contracts: addresses.flatMap((address) => [
        { address, abi: ERC4626_ABI, functionName: "asset" },
        { address, abi: ERC4626_ABI, functionName: "symbol" },
        { address, abi: ERC4626_ABI, functionName: "name" },
      ]),
      multicallAddress: MULTICALL3,
      allowFailure: true,
    });
    addresses.forEach((address, i) => {
      const [assetRes, symbolRes, nameRes] = [
        results[i * 3],
        results[i * 3 + 1],
        results[i * 3 + 2],
      ];
      if (assetRes?.status !== "success") return;
      const asset = String(assetRes.result).toLowerCase() as Address;
      if (!asset || asset === ZERO) return;
      rows.push({
        address,
        asset,
        symbol:
          symbolRes?.status === "success" ? String(symbolRes.result) : null,
        name: nameRes?.status === "success" ? String(nameRes.result) : null,
      });
    });
    return rows;
  }

  for (const address of addresses) {
    const asset = await read<string>(client, address, ERC4626_ABI, "asset");
    if (!asset || asset.toLowerCase() === ZERO) continue;
    rows.push({
      address,
      asset: asset.toLowerCase() as Address,
      symbol: await read<string>(client, address, ERC4626_ABI, "symbol"),
      name: await read<string>(client, address, ERC4626_ABI, "name"),
    });
  }
  return rows;
}

async function cachedVaults(
  key: string,
  load: () => Promise<VaultRow[]>,
): Promise<VaultRow[]> {
  const hit = vaultCache.get(key);
  if (hit && Date.now() - hit.at < VAULT_TTL_MS) return hit.rows;
  const rows = await load();
  // Only cache a non-empty answer: an empty list is usually a transient RPC
  // failure, and caching it would blind the family for the whole window.
  if (rows.length > 0) vaultCache.set(key, { at: Date.now(), rows });
  return rows;
}

/** Test seam. */
export function resetCandidateVaultCache(): void {
  vaultCache.clear();
}

/**
 * Match an enumerated vault list against a pool, using the same never-guess
 * rule everywhere: filter by the deposited asset, then require a label to
 * select exactly one.
 */
function matchVault(
  rows: readonly VaultRow[],
  pool: DeFiLlamaYieldPool,
): Address | null {
  const underlying = underlyingOf(pool);
  if (!underlying) return null;
  const sameAsset = rows.filter((r) => eqAddr(r.asset, underlying));
  if (sameAsset.length === 0) return null;
  const match = pickUniqueByLabel(
    sameAsset,
    [pool.poolMeta, pool.symbol],
    (r) => [r.symbol, r.name],
  );
  return match?.address ?? null;
}

// ── Euler v2 — GenericFactory proxy list ────────────────────────────────────

/** Euler's factory lists every EVK vault ever deployed; ~900 on mainnet. */
export const EulerVaultCandidateSource: CandidateSource = {
  id: "euler-generic-factory",
  projects: ["euler", "euler-v2", "euler-finance"],
  async candidate(pool, ctx) {
    const chainId = resolveEvmChainId(pool.chain);
    const factory = EULER_VAULT_FACTORIES[chainId];
    const client = ctx.publicClient?.(chainId);
    if (!factory || !client) return null;

    const rows = await cachedVaults(`euler:${chainId}`, async () => {
      const length = await read<bigint>(
        client,
        factory,
        FACTORY_ABI,
        "getProxyListLength",
      );
      if (!length || length === 0n) return [];
      // Slice rather than one huge call: the list only grows, and a bounded
      // page keeps a single RPC response from being rejected for size.
      const total = Number(length);
      const addresses: Address[] = [];
      const PAGE = 250;
      for (let start = 0; start < total; start += PAGE) {
        const end = Math.min(start + PAGE, total);
        const page = await read<string[]>(
          client,
          factory,
          FACTORY_ABI,
          "getProxyListSlice",
          [BigInt(start), BigInt(end)],
        );
        if (!page) break;
        addresses.push(...(page.map((a) => a.toLowerCase()) as Address[]));
      }
      return describeVaults(client, addresses);
    });

    return matchVault(rows, pool);
  },
};

// ── Fluid — LendingResolver.getAllFTokens() ─────────────────────────────────

export const FluidVaultCandidateSource: CandidateSource = {
  id: "fluid-lending-resolver",
  projects: ["fluid", "fluid-lending", "instadapp-fluid"],
  async candidate(pool, ctx) {
    const chainId = resolveEvmChainId(pool.chain);
    const resolver = FLUID_LENDING_RESOLVERS[chainId];
    const client = ctx.publicClient?.(chainId);
    if (!resolver || !client) return null;

    const rows = await cachedVaults(`fluid:${chainId}`, async () => {
      const tokens = await read<string[]>(
        client,
        resolver,
        FLUID_ABI,
        "getAllFTokens",
      );
      if (!tokens?.length) return [];
      return describeVaults(
        client,
        tokens.map((t) => t.toLowerCase()) as Address[],
      );
    });

    return matchVault(rows, pool);
  },
};

// ── Curve — MetaRegistry, reached through the pinned AddressProvider ────────

/**
 * Curve's own registry answers "which pool holds these two coins", so a Curve
 * pool needs no aggregator at all — as long as DeFiLlama gives us two of its
 * underlying tokens, which for a Curve row it does.
 */
export const CurvePoolCandidateSource: CandidateSource = {
  id: "curve-metaregistry",
  projects: ["curve-dex", "curve", "curve-finance", "curve-llamalend"],
  async candidate(pool, ctx) {
    const chainId = resolveEvmChainId(pool.chain);
    const client = ctx.publicClient?.(chainId);
    if (!client) return null;

    const coins = (pool.underlyingTokens ?? []).filter(
      (t): t is string => typeof t === "string" && t.startsWith("0x"),
    );
    if (coins.length < 2) return null;

    const metaRegistry = await read<string>(
      client,
      CURVE_ADDRESS_PROVIDER,
      CURVE_ABI,
      "get_address",
      [BigInt(CURVE_METAREGISTRY_ID)],
    );
    if (!metaRegistry || metaRegistry.toLowerCase() === ZERO) return null;

    const found = await read<string>(
      client,
      metaRegistry.toLowerCase() as Address,
      CURVE_ABI,
      "find_pool_for_coins",
      [coins[0], coins[1]],
    );
    if (!found || found.toLowerCase() === ZERO) return null;
    return found.toLowerCase() as Address;
  },
};

// ── Solidly forks — the factory computes the pool address ───────────────────

/**
 * A Solidly pool is a deterministic function of `(token0, token1, stable)`, so
 * the factory can be asked directly. Both stability flags are tried and the
 * answer must be UNIQUE: if a token pair has both a stable and a volatile pool
 * (common), there is nothing here to tell them apart and guessing would put the
 * user in the wrong pool with a different risk profile.
 */
export const SolidlyPoolCandidateSource: CandidateSource = {
  id: "solidly-factory",
  projects: ["aerodrome-v1", "aerodrome", "velodrome-v2", "velodrome"],
  async candidate(pool, ctx) {
    const chainId = resolveEvmChainId(pool.chain);
    const deployment = solidlyDeployment(chainId);
    const client = ctx.publicClient?.(chainId);
    if (!deployment || !client) return null;

    const tokens = (pool.underlyingTokens ?? []).filter(
      (t): t is string => typeof t === "string" && t.startsWith("0x"),
    );
    if (tokens.length < 2) return null;

    const found: Address[] = [];
    for (const stable of [true, false]) {
      const address = await read<string>(
        client,
        deployment.factory,
        SOLIDLY_FACTORY_ABI,
        "getPool",
        [tokens[0], tokens[1], stable],
      );
      if (address && address.toLowerCase() !== ZERO) {
        found.push(address.toLowerCase() as Address);
      }
    }
    return found.length === 1 ? found[0] : null;
  },
};

export const ONCHAIN_CANDIDATE_SOURCES: readonly CandidateSource[] = [
  EulerVaultCandidateSource,
  FluidVaultCandidateSource,
  CurvePoolCandidateSource,
  SolidlyPoolCandidateSource,
];
