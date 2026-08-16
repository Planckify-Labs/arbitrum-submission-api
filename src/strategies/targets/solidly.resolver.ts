/**
 * Tier 3 — Solidly-fork LP: Aerodrome (Base) / Velodrome (Optimism), §6.1.
 *
 * Deposits go through the Router's
 * `addLiquidity(tokenA, tokenB, stable, amountA, amountB, minA, minB, to, deadline)`.
 * The Router is address-book-pinned (§12 Q7); the pool's identity —
 * `token0`, `token1` and the `stable` flag that picks the invariant — is read
 * from the pool contract itself at resolve time.
 *
 * `stable` is not cosmetic: passing the wrong invariant addresses a different
 * pool entirely, so it is proven on-chain rather than inferred from the pool's
 * name or DeFiLlama's `exposure` field.
 */

import { solidlyDeployment } from "./address-book";
import { candidateAddressForPool } from "./candidates/registry";
import type {
  Address,
  DepositTarget,
  EvmReadClient,
  PoolTargetResolver,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

const SOLIDLY_POOL_ABI = [
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
  {
    name: "stable",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function readPoolIdentity(
  client: EvmReadClient,
  pool: Address,
): Promise<{ token0: Address; token1: Address; stable: boolean } | null> {
  try {
    const [token0, token1, stable] = (await Promise.all([
      client.readContract({
        address: pool,
        abi: SOLIDLY_POOL_ABI,
        functionName: "token0",
      }),
      client.readContract({
        address: pool,
        abi: SOLIDLY_POOL_ABI,
        functionName: "token1",
      }),
      client.readContract({
        address: pool,
        abi: SOLIDLY_POOL_ABI,
        functionName: "stable",
      }),
    ])) as [Address, Address, boolean];
    if (!token0 || !token1) return null;
    return {
      token0: token0.toLowerCase() as Address,
      token1: token1.toLowerCase() as Address,
      stable: Boolean(stable),
    };
  } catch {
    // No `stable()` ⇒ not a Solidly pool (a Uniswap-v2 pair also has
    // token0/token1, and depositing into one through a Solidly router would
    // revert or land somewhere unintended). Fail closed.
    return null;
  }
}

function solidlyResolver(config: {
  family: string;
  aliases: readonly string[];
}): PoolTargetResolver {
  return {
    family: config.family,
    aliases: config.aliases,
    async resolve(pool, ctx): Promise<DepositTarget | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) return null;
      const deployment = solidlyDeployment(chainId);
      if (!deployment) return null;
      const underlying = underlyingOf(pool);
      if (!underlying) return null;

      const client = ctx.publicClient?.(chainId);
      if (!client) return null;

      const poolAddress = await candidateAddressForPool(pool, ctx);
      if (!poolAddress) return null;

      const identity = await readPoolIdentity(client, poolAddress);
      if (!identity) return null;

      // The asset the user deposits must actually be one of the pair's legs.
      if (
        !eqAddr(identity.token0, underlying) &&
        !eqAddr(identity.token1, underlying)
      ) {
        return null;
      }

      const target: DepositTarget = {
        kind: "solidly-lp",
        router: deployment.router,
        pool: poolAddress,
        token0: identity.token0,
        token1: identity.token1,
        stable: identity.stable,
      };
      return (await ctx.validate(target, pool)) ? target : null;
    },
  };
}

export const AerodromeResolver = solidlyResolver({
  family: "aerodrome",
  aliases: ["aerodrome-v1", "aerodrome", "aerodrome-slipstream"],
});

export const VelodromeResolver = solidlyResolver({
  family: "velodrome",
  aliases: ["velodrome-v2", "velodrome", "velodrome-slipstream"],
});

export const TIER3_SOLIDLY_RESOLVERS: readonly PoolTargetResolver[] = [
  AerodromeResolver,
  VelodromeResolver,
];
