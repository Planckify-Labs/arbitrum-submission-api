/**
 * Tier 2 — Curve LP (spec §5.3), generalising the shipped single-market
 * `curve3pool` adapter to any Curve pool.
 *
 * Curve's ABI varies by generation, and the two variations that matter are
 * exactly the two fields §3.3 puts on the target:
 *
 *  - **arity** — `add_liquidity(uint256[N] amounts, uint256 min_mint)` where N
 *    is the pool's coin count, so the encoder needs N up front.
 *  - **index type** — legacy pools take `int128 i` in
 *    `remove_liquidity_one_coin`; new-generation (NG) pools take `uint256 i`.
 *
 * Both are read **from the chain at resolve time** rather than fetched from
 * Curve's API, then carried on the target so the adapter never probes per
 * build. Chain state cannot be spoofed by a compromised API — this keeps the
 * whole family out of §11 Layer-6's untrusted-data surface.
 *
 * Fail closed when the coin index for the underlying is not unique (a pool
 * holding the same asset twice, or an asset we cannot locate): a wrong index
 * deposits into the wrong leg.
 */

import { CURVE_ADDRESS_PROVIDER, curveMetaRegistryId } from "./address-book";
import { candidateAddressForPool } from "./candidates/registry";
import type {
  Address,
  DepositTarget,
  EvmReadClient,
  PoolTargetResolver,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

const COINS_ABI = [
  {
    name: "coins",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** Legacy generation: `int128` coin index. */
const CALC_WITHDRAW_LEGACY_ABI = [
  {
    name: "calc_withdraw_one_coin",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_burn_amount", type: "uint256" },
      { name: "i", type: "int128" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** New generation (stableswap-ng / twocrypto-ng): `uint256` coin index. */
const CALC_WITHDRAW_NG_ABI = [
  {
    name: "calc_withdraw_one_coin",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_burn_amount", type: "uint256" },
      { name: "i", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const MAX_COINS = 4;

/**
 * Read `coins(0..3)` until the call reverts. Curve pools expose the array
 * directly; the first revert marks the end, which is how the pool itself
 * reports its arity.
 */
const LP_TOKEN_ABI = [
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Does this pool contract also serve as its own LP token?
 *
 * Classic Curve pools mint a SEPARATE ERC-20 and expose neither `totalSupply`
 * nor `balanceOf`; NG pools are the token. Probing both is what tells the two
 * generations apart without a version list to maintain.
 */
async function isOwnLpToken(
  client: EvmReadClient,
  pool: Address,
): Promise<boolean> {
  try {
    const supply = await client.readContract({
      address: pool,
      abi: LP_TOKEN_ABI,
      functionName: "totalSupply",
    });
    if (typeof supply !== "bigint" || supply === 0n) return false;
    await client.readContract({
      address: pool,
      abi: LP_TOKEN_ABI,
      functionName: "balanceOf",
      args: ["0x0000000000000000000000000000000000000000"],
    });
    return true;
  } catch {
    return false;
  }
}

const METAREGISTRY_ABI = [
  {
    name: "get_address",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "get_lp_token",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "pool", type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Curve's own MetaRegistry answer for "what is this pool's LP token" —
 * authoritative because it is the SAME registry `CurvePoolCandidateSource`
 * already trusts to find the pool in the first place (§11.6), reached through
 * the same pinned `AddressProvider` (deterministic on every chain Curve
 * deploys to) and the same per-chain MetaRegistry slot the drift spec checks.
 *
 * `null` on any chain without a reviewed MetaRegistry slot, any AddressProvider
 * miss, or an LP token with no code — every one of those degrades the pool to
 * Manual rather than trusting an unreviewed answer.
 */
export /**
 * Typed to just the one method this needs, rather than the full
 * `EvmReadClient` — viem's concrete `PublicClient` (what the Layer-1
 * validator passes) and the resolver's structural `EvmReadClient` disagree on
 * `multicall`'s return shape, and this function never calls `multicall`.
 */
interface ReadContractClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export async function metaRegistryLpToken(
  client: ReadContractClient,
  chainId: number,
  pool: Address,
): Promise<Address | null> {
  const metaRegistryId = curveMetaRegistryId(chainId);
  if (metaRegistryId === null) return null;
  try {
    const metaRegistry = (await client.readContract({
      address: CURVE_ADDRESS_PROVIDER,
      abi: METAREGISTRY_ABI,
      functionName: "get_address",
      args: [BigInt(metaRegistryId)],
    })) as Address;
    if (!metaRegistry || eqAddr(metaRegistry, ZERO_ADDRESS)) return null;

    const lpToken = (await client.readContract({
      address: metaRegistry.toLowerCase() as Address,
      abi: METAREGISTRY_ABI,
      functionName: "get_lp_token",
      args: [pool],
    })) as Address;
    if (!lpToken || eqAddr(lpToken, ZERO_ADDRESS)) return null;
    return lpToken.toLowerCase() as Address;
  } catch {
    return null;
  }
}

async function readCoins(
  client: EvmReadClient,
  pool: Address,
): Promise<Address[]> {
  const coins: Address[] = [];
  for (let i = 0; i < MAX_COINS; i++) {
    try {
      const coin = (await client.readContract({
        address: pool,
        abi: COINS_ABI,
        functionName: "coins",
        args: [BigInt(i)],
      })) as Address;
      if (!coin || eqAddr(coin, "0x0000000000000000000000000000000000000000"))
        break;
      coins.push(coin.toLowerCase() as Address);
    } catch {
      break;
    }
  }
  return coins;
}

/**
 * Probe which `calc_withdraw_one_coin` signature the pool answers. Done ONCE
 * here so `buildWithdraw` can branch on `target.isNg` instead of probing on
 * every build (§3.3). Returns null when neither responds — an ABI we do not
 * understand is one we do not deposit into.
 */
async function detectIsNg(
  client: EvmReadClient,
  pool: Address,
  index: number,
): Promise<boolean | null> {
  const probe = 10n ** 18n;
  try {
    await client.readContract({
      address: pool,
      abi: CALC_WITHDRAW_LEGACY_ABI,
      functionName: "calc_withdraw_one_coin",
      args: [probe, index],
    });
    return false;
  } catch {
    // fall through to the NG shape
  }
  try {
    await client.readContract({
      address: pool,
      abi: CALC_WITHDRAW_NG_ABI,
      functionName: "calc_withdraw_one_coin",
      args: [probe, BigInt(index)],
    });
    return true;
  } catch {
    return null;
  }
}

export const CurveResolver: PoolTargetResolver = {
  family: "curve",
  // Deliberately NOT "curve-llamalend" (its lending vaults are ERC-4626 and
  // route to Family A) and NOT "convex-finance" (a boosting venue on top of an
  // LP, which needs the two-leg flow §6.3 defers).
  aliases: ["curve-dex", "curve", "curve-finance"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;

    const client = ctx.publicClient?.(chainId);
    if (!client) return null;

    const poolAddress = await candidateAddressForPool(pool, ctx);
    if (!poolAddress) return null;

    const coins = await readCoins(client, poolAddress);
    if (coins.length < 2 || coins.length > MAX_COINS) return null;

    // The index must be UNAMBIGUOUS. A duplicate-asset pool (or an asset that
    // isn't a coin at all) is exactly the case where a guess deposits into the
    // wrong leg, so we refuse it (§5.3).
    const matches = coins
      .map((coin, i) => ({ coin, i }))
      .filter((c) => eqAddr(c.coin, underlying));
    if (matches.length !== 1) return null;
    const index = matches[0].i;

    const isNg = await detectIsNg(client, poolAddress, index);
    if (isNg === null) return null;

    // Is the pool its own LP token (NG), or does it mint a separate ERC-20
    // (classic — 3pool and its lineage)? Both are supported; only the SOURCE
    // of the receipt address differs.
    //
    // Added 2026-08-21: classic pools used to refuse here outright, because
    // the union carried no `lpToken` and every reader assumed `pool` doubled
    // as the receipt — true for NG, false for classic, where the pool
    // contract has no `balanceOf` at all. A guessed value would read a
    // balance off the wrong contract and burn nothing on a `MAX` withdraw, so
    // the fix is to fetch it from the SAME first-party registry that found the
    // pool, never to infer or guess it.
    let lpToken: Address | undefined;
    if (!(await isOwnLpToken(client, poolAddress))) {
      const found = await metaRegistryLpToken(client, chainId, poolAddress);
      if (!found) return null; // no reviewed registry answer → fail closed
      lpToken = found;
    }

    const target: DepositTarget = {
      kind: "curve-lp",
      pool: poolAddress,
      asset: underlying as Address,
      index,
      nCoins: coins.length as 2 | 3 | 4,
      isNg,
      ...(lpToken ? { lpToken } : {}),
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};
