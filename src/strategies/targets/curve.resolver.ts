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

    // The pool must BE its own LP token.
    //
    // `curveLp.ts:lpTokenOf` returns `target.pool`, which holds for Curve's NG
    // generation and is false for the classic pools — 3pool's LP token is a
    // separate ERC-20. The union carries no `lpToken`, so a classic pool would
    // resolve fine and then read the user's balance off the wrong contract,
    // surfacing at `MAX` withdraw as an exit that cannot be built.
    //
    // Refusing here is the fail-closed half of the fix (§8.2): a classic pool
    // degrades to Manual instead of badging "Deposit in-app". Supporting them
    // properly means adding `lpToken` to the shared union, which is a change to
    // both repos and the parity test.
    if (!(await isOwnLpToken(client, poolAddress))) return null;

    const target: DepositTarget = {
      kind: "curve-lp",
      pool: poolAddress,
      asset: underlying as Address,
      index,
      nCoins: coins.length as 2 | 3 | 4,
      isNg,
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};
