/**
 * Tier 3 — Uniswap v2 pairs, the family Solidly forked from and the simplest
 * shape in the LP family: no invariant choice (every v2 pool is
 * constant-product), and the pair contract IS its own LP token.
 *
 * Deposits go through the Router's
 * `addLiquidity(tokenA, tokenB, amountA, amountB, minA, minB, to, deadline)`.
 * The Router is address-book-pinned (§12 Q7); the pair's identity — `token0`,
 * `token1` — is read from the pair contract itself at resolve time, never
 * inferred from DeFiLlama's symbol.
 */

import { uniswapV2Deployment } from "./address-book";
import { candidateAddressForPool } from "./candidates/registry";
import type {
  Address,
  DepositTarget,
  EvmReadClient,
  PoolTargetResolver,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

const PAIR_ABI = [
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "token1",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

async function readPairIdentity(
  client: EvmReadClient,
  pair: Address,
): Promise<{ token0: Address; token1: Address } | null> {
  try {
    const [token0, token1] = (await Promise.all([
      client.readContract({
        address: pair,
        abi: PAIR_ABI,
        functionName: "token0",
      }),
      client.readContract({
        address: pair,
        abi: PAIR_ABI,
        functionName: "token1",
      }),
    ])) as [Address, Address];
    if (!token0 || !token1) return null;
    return {
      token0: token0.toLowerCase() as Address,
      token1: token1.toLowerCase() as Address,
    };
  } catch {
    return null;
  }
}

export const UniswapV2Resolver: PoolTargetResolver = {
  family: "uniswap-v2",
  aliases: ["uniswap-v2", "uniswap"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;
    const deployment = uniswapV2Deployment(chainId);
    if (!deployment) return null;
    const underlying = underlyingOf(pool);
    if (!underlying) return null;

    const client = ctx.publicClient?.(chainId);
    if (!client) return null;

    const pairAddress = await candidateAddressForPool(pool, ctx);
    if (!pairAddress) return null;

    const identity = await readPairIdentity(client, pairAddress);
    if (!identity) return null;

    // The asset the user deposits must actually be one of the pair's legs.
    if (
      !eqAddr(identity.token0, underlying) &&
      !eqAddr(identity.token1, underlying)
    ) {
      return null;
    }

    const target: DepositTarget = {
      kind: "uniswap-v2",
      router: deployment.router,
      pool: pairAddress,
      token0: identity.token0,
      token1: identity.token1,
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};

export const TIER3_UNISWAP_V2_RESOLVERS: readonly PoolTargetResolver[] = [
  UniswapV2Resolver,
];
