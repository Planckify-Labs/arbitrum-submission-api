/**
 * Tier 4 — Centrifuge, the first `async-vault` (ERC-7540) protocol (spec §7).
 *
 * Everything the two-phase request/claim UX needs (`StrategyPosition.asyncPhase`,
 * `async-claim-watcher.processor.ts`, the mobile adapter's four two-phase
 * methods, `defi_claim`'s async branch) landed before this file did — see
 * `docs/runbooks/add-defi-pool-resolver.md` §7. This is the resolver §7 said
 * was the last piece: nothing badges "Deposit in-app" for an async pool until
 * a target actually resolves, and this is the first one that does.
 *
 * Discovery is Centrifuge's own public GraphQL API (`api.centrifuge.io`), the
 * same source `DefiLlama/yield-server/src/adaptors/centrifuge-protocol` reads
 * — read as documentation, not copied (that repo ships no LICENSE; verified
 * 2026-08-19, same as every other adaptor this codebase has consulted). It
 * returns the vault CONTRACT ADDRESS directly (`items[].id`), not a deep link
 * to parse, so there is no address-extraction step to get wrong.
 *
 * Verified on chain 2026-08-22 against a live vault
 * (`0x18ab9fc0b2e4fef9e0e03c8ec63ba287a3238257`, Ethereum, "JTRSY deRWA"):
 * `supportsInterface(0x2f0a18c5)` (ERC-7540) → true, `asset()` → USDC
 * (matches the API), `share()` → the exact share address the API reports,
 * `pending/claimableDepositRequest` AND `pending/claimableRedeemRequest` all
 * answer → `flavor: "7540-both"` for every vault this resolver emits.
 */

import { CENTRIFUGE_VAULT_REGISTRY } from "./address-book";
import { warnOnce } from "./candidates/protocol-api.source";
import type {
  Address,
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

const VAULT_REGISTRY_ABI = [
  {
    name: "isLinked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault_", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Is this vault the CURRENT one for its (pool, share class, asset), per
 * Centrifuge's own on-chain registry — not per their GraphQL indexer, which
 * (verified 2026-08-22) lists superseded vault contracts alongside the live
 * one with no field distinguishing them. `false` on any read failure: an
 * unreadable registry answer is not a linked vault.
 */
/**
 * Typed to just the one method this needs, matching `metaRegistryLpToken`'s
 * `ReadContractClient` in `curve.resolver.ts` — viem's concrete
 * `PublicClient` (what the Layer-1 validator passes) and the resolver's
 * structural `EvmReadClient` disagree on `multicall`'s return shape, and
 * this function never calls `multicall`.
 */
interface ReadContractClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export async function isLinkedOnChain(
  client: ReadContractClient,
  vault: Address,
): Promise<boolean> {
  try {
    return Boolean(
      await client.readContract({
        address: CENTRIFUGE_VAULT_REGISTRY,
        abi: VAULT_REGISTRY_ABI,
        functionName: "isLinked",
        args: [vault],
      }),
    );
  } catch {
    return false;
  }
}

const VAULT_LIST_TTL_SEC = 30 * 60; // matches the poll cadence

/**
 * `centrifugeId` → EVM chainId, for the chains verified against the live API
 * response 2026-08-22 (Ethereum 34 vaults, Base 8, Arbitrum 19 — the three
 * this codebase has a `Blockchain` row for). The yield-server adaptor's
 * `CHAIN_MAP` lists more (Avalanche, BSC, Optimism, Plume, Monad, Pharos,
 * Hyperliquid); none of those chain-id mappings were independently confirmed
 * here, so they are deliberately absent rather than guessed — a wrong
 * centrifugeId->chainId pairing would route a deposit onto the wrong network
 * entirely. Add a row only after confirming it the same way: query the API,
 * pick a vault, verify `supportsInterface`/`asset()` on that ACTUAL chain.
 */
const CENTRIFUGE_ID_TO_CHAIN_ID: Readonly<Record<string, number>> = {
  "1": 1, // Ethereum
  "2": 8453, // Base
  "3": 42161, // Arbitrum
};

interface CentrifugeVault {
  id: string;
  centrifugeId: string;
  assetAddress: string;
  token: { name?: string | null; symbol?: string | null };
}

const VAULTS_QUERY = `query {
  vaults(where: { isActive: true }, limit: 500) {
    items {
      id
      centrifugeId
      assetAddress
      token { name symbol }
    }
    pageInfo { hasNextPage }
  }
}`;

/** Exported so the drift spec can assert this exact query still parses. */
export const CENTRIFUGE_VAULTS_QUERY = VAULTS_QUERY;

async function fetchCentrifugeVaults(
  ctx: ResolverContext,
): Promise<CentrifugeVault[]> {
  const res = await ctx.fetchJsonCached<{
    data?: { vaults?: { items?: CentrifugeVault[] } };
    errors?: Array<{ message?: string }>;
  }>(
    "defillama:targets:centrifuge:vaults:v1",
    "https://api.centrifuge.io/",
    VAULT_LIST_TTL_SEC,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: VAULTS_QUERY }),
    },
  );
  if (res?.errors?.length) {
    console.warn(
      `[centrifuge] vaults query rejected by api.centrifuge.io (schema drift?): ${res.errors
        .map((e) => e.message ?? "unknown")
        .join("; ")}`,
    );
    return [];
  }
  const items = res?.data?.vaults?.items ?? [];
  if (items.length === 0) {
    warnOnce(
      "centrifuge-vaults-empty",
      "[centrifuge] api.centrifuge.io returned no vaults. Check the endpoint " +
        "before assuming the protocol has none — this is the same failure " +
        "shape that hid /poolsOld's outage (runbook §11.5b).",
    );
  }
  return items;
}

/** Case/punctuation-insensitive identity for a product-name comparison. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * EXACT match only — deliberately not the fuzzy `includes()` matching used
 * elsewhere in this file's siblings. Centrifuge's own product names are the
 * kind of near-miss pair that fuzzy matching mis-routes: "JAAA" is a
 * substring of "deJAAA", and both are real, distinct, currently-listed
 * vaults sharing an asset on the same chain. §11.6b is the record of what
 * bidirectional substring matching did to 25 Morpho pools; this does not
 * repeat it.
 */
function pickByExactLabel(
  candidates: readonly CentrifugeVault[],
  needles: readonly (string | null | undefined)[],
): CentrifugeVault | null {
  for (const needle of needles) {
    if (!needle) continue;
    const target = normalise(needle);
    const hits = candidates.filter(
      (c) =>
        normalise(c.token.name ?? "") === target ||
        normalise(c.token.symbol ?? "") === target,
    );
    if (hits.length === 1) return hits[0];
  }
  // Nothing to disambiguate with, but only one thing it could be.
  return candidates.length === 1 ? candidates[0] : null;
}

export const CentrifugeResolver: PoolTargetResolver = {
  family: "centrifuge",
  aliases: ["centrifuge-protocol", "centrifuge"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;
    const client = ctx.publicClient?.(chainId);
    if (!client) return null;

    const vaults = await fetchCentrifugeVaults(ctx);
    const onChain = vaults.filter(
      (v) => CENTRIFUGE_ID_TO_CHAIN_ID[v.centrifugeId] === chainId,
    );
    const sameAsset = onChain.filter((v) => eqAddr(v.assetAddress, underlying));
    if (sameAsset.length === 0) return null;

    // Ask the registry BEFORE the label, same reordering §11.6b applied to
    // Morpho/Yearn: an address-backed identity claim outranks a name match,
    // and here it is the only thing that can tell a live vault apart from a
    // superseded one the API still lists.
    const linked = (
      await Promise.all(
        sameAsset.map(async (v) => ({
          v,
          ok: await isLinkedOnChain(client, v.id.toLowerCase() as Address),
        })),
      )
    )
      .filter((r) => r.ok)
      .map((r) => r.v);
    if (linked.length === 0) return null;

    const match =
      linked.length === 1
        ? linked[0]
        : pickByExactLabel(linked, [pool.poolMeta, pool.symbol]);
    if (!match) return null;

    const target: DepositTarget = {
      kind: "async-vault",
      vault: match.id.toLowerCase() as Address,
      asset: underlying as Address,
      // Verified 2026-08-22 on a sample vault: both request-deposit and
      // request-redeem views answer, so every vault this resolver emits is
      // treated as supporting both. A vault where that turns out false would
      // still fail closed at the CALL site (`buildRequestRedeem` refuses a
      // "7540-deposit"-only target, §7's adapter already enforces this) —
      // this flag is a UX hint for which flows to show, not the safety
      // boundary.
      flavor: "7540-both",
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};

export const TIER4_CENTRIFUGE_RESOLVERS: readonly PoolTargetResolver[] = [
  CentrifugeResolver,
];
