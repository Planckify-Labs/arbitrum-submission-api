/**
 * Read-only EVM RPC clients for pool-target validation (spec §3.2).
 *
 * Validation runs at poll/score time (backend, off the request path), so a
 * public RPC is sufficient. Precedence per chain:
 *   1. `STRATEGIES_RPC_URL_<chainId>` env override (ops can point at Alchemy…)
 *   2. viem's bundled chain default RPC.
 *
 * Clients are memoised per chainId. All reads are best-effort; callers
 * fail closed (treat an unreadable target as unresolved → manual).
 */

import { http, type Chain, type PublicClient, createPublicClient } from "viem";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  56: bsc,
  137: polygon,
  8453: base,
  42161: arbitrum,
  43114: avalanche,
};

const clients = new Map<number, PublicClient>();

export function getEvmChain(chainId: number): Chain | null {
  return CHAINS[chainId] ?? null;
}

export function getPublicClientForChain(chainId: number): PublicClient | null {
  const cached = clients.get(chainId);
  if (cached) return cached;
  const chain = CHAINS[chainId];
  if (!chain) return null;
  const override = process.env[`STRATEGIES_RPC_URL_${chainId}`];
  const url = override?.trim() || chain.rpcUrls.default.http[0] || undefined;
  const client = createPublicClient({
    chain,
    transport: http(url),
  }) as PublicClient;
  clients.set(chainId, client);
  return client;
}
