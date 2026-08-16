/**
 * Tier 3 — Balancer v2/v3 and Beets (spec §6.2).
 *
 * A Balancer pool is joined through the **Vault** by its registration
 * `poolId`, not by calling the pool contract. The Vault is a singleton and is
 * address-book-pinned (§12 Q7); the `poolId` is read from the pool contract
 * itself (`getPoolId()`), which is also the check that the candidate address is
 * a real Balancer pool at all — a non-Balancer contract has no such selector
 * and fails closed.
 */

import { balancerVault } from "./address-book";
import { candidateAddressForPool } from "./candidates/registry";
import type {
  Address,
  DepositTarget,
  EvmReadClient,
  Hex,
  PoolTargetResolver,
} from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

const POOL_ABI = [
  {
    name: "getPoolId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "getVault",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

async function readPoolId(
  client: EvmReadClient,
  pool: Address,
): Promise<{ poolId: Hex; vault: Address | null } | null> {
  try {
    const poolId = (await client.readContract({
      address: pool,
      abi: POOL_ABI,
      functionName: "getPoolId",
    })) as Hex;
    if (!poolId || !/^0x[0-9a-fA-F]{64}$/.test(poolId)) return null;
    // `getVault()` is not on every pool type; when present it lets us confirm
    // the pool belongs to the Vault we pinned rather than a look-alike.
    let vault: Address | null = null;
    try {
      vault = (
        (await client.readContract({
          address: pool,
          abi: POOL_ABI,
          functionName: "getVault",
        })) as Address
      ).toLowerCase() as Address;
    } catch {
      vault = null;
    }
    return { poolId, vault };
  } catch {
    return null;
  }
}

function balancerResolver(config: {
  family: string;
  aliases: readonly string[];
}): PoolTargetResolver {
  return {
    family: config.family,
    aliases: config.aliases,
    async resolve(pool, ctx): Promise<DepositTarget | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) return null;
      const underlying = underlyingOf(pool);
      if (!underlying) return null;

      const client = ctx.publicClient?.(chainId);
      if (!client) return null;

      const poolAddress = await candidateAddressForPool(pool, ctx);
      if (!poolAddress) return null;

      const identity = await readPoolId(client, poolAddress);
      if (!identity) return null;

      // Prefer the v3 Vault where the pool reports one we pinned; otherwise
      // fall back to the long-standing v2 singleton. A pool whose self-reported
      // Vault matches NEITHER pinned Vault is rejected — that is the
      // look-alike defence (§11 Layer-1).
      const v3 = balancerVault(chainId, "v3");
      const v2 = balancerVault(chainId, "v2");
      let vault: Address | null = null;
      if (identity.vault) {
        if (v3 && eqAddr(identity.vault, v3)) vault = v3;
        else if (v2 && eqAddr(identity.vault, v2)) vault = v2;
        else return null;
      } else {
        vault = v2 ?? v3;
      }
      if (!vault) return null;

      const target: DepositTarget = {
        kind: "balancer-lp",
        vault,
        poolId: identity.poolId,
        asset: underlying as Address,
      };
      return (await ctx.validate(target, pool)) ? target : null;
    },
  };
}

export const BalancerResolver = balancerResolver({
  family: "balancer",
  aliases: ["balancer-v2", "balancer-v3", "balancer"],
});

export const BeetsResolver = balancerResolver({
  family: "beets",
  aliases: ["beethoven-x", "beets", "beets-dex"],
});

export const TIER3_BALANCER_RESOLVERS: readonly PoolTargetResolver[] = [
  BalancerResolver,
  BeetsResolver,
];
