/**
 * Read-only EVM RPC clients for pool-target validation (spec §3.2).
 *
 * Chains are **data-driven**: the client is synthesised from the `Blockchain`
 * row in `chain-directory.ts`, so validating on a newly-onboarded EVM chain
 * needs a seeded row and an rpc-proxy route — no bundled per-chain constant and
 * no code change here.
 *
 * Endpoint precedence per chain:
 *   1. `STRATEGIES_RPC_URL_<chainId>` env override (ops escape hatch).
 *   2. The row's `rpcUrl`, resolved through `resolveRpcEndpoint` — normally an
 *      rpc-proxy route, which is also spec §11 Layer-6 "route reads through the
 *      trusted rpc-proxy" rather than a public endpoint we don't control.
 *
 * Clients are memoised per chainId and invalidated when the directory reloads.
 * All reads are best-effort; callers fail closed (an unreadable target is an
 * unresolved target → Manual).
 */

import { http, type Chain, type PublicClient, createPublicClient } from "viem";
import { resolveRpcEndpoint } from "../../blockchains/rpc-endpoint";
import { findChainById, viemChainFromRow } from "./chain-directory";

interface CachedClient {
  client: PublicClient;
  /** The row identity the client was built from; a reload invalidates it. */
  rpcUrl: string;
}

const clients = new Map<number, CachedClient>();

export function getEvmChain(chainId: number): Chain | null {
  const row = findChainById(chainId);
  if (!row || row.family !== "EVM" || typeof row.chainId !== "number")
    return null;
  const endpoint = resolveEndpoint(row.rpcUrl, chainId);
  if (!endpoint) return null;
  return viemChainFromRow(row, endpoint.url);
}

function resolveEndpoint(
  rpcUrl: string,
  chainId: number,
): { url: string; headers: Record<string, string> } | null {
  const override = process.env[`STRATEGIES_RPC_URL_${chainId}`]?.trim();
  if (override) return { url: override, headers: {} };
  try {
    return resolveRpcEndpoint(rpcUrl);
  } catch {
    // Proxy route stored but RPC_PROXY_URL unset — fail closed rather than
    // calling a nonsense URL.
    return null;
  }
}

export function getPublicClientForChain(chainId: number): PublicClient | null {
  const row = findChainById(chainId);
  if (!row || row.family !== "EVM" || typeof row.chainId !== "number")
    return null;

  const cached = clients.get(chainId);
  if (cached && cached.rpcUrl === row.rpcUrl) return cached.client;

  const endpoint = resolveEndpoint(row.rpcUrl, chainId);
  if (!endpoint) return null;

  const client = createPublicClient({
    chain: viemChainFromRow(row, endpoint.url),
    transport: http(endpoint.url, {
      fetchOptions: Object.keys(endpoint.headers).length
        ? { headers: endpoint.headers }
        : undefined,
    }),
  }) as PublicClient;
  clients.set(chainId, { client, rpcUrl: row.rpcUrl });
  return client;
}

/** Drop memoised clients — called when the chain directory is reloaded. */
export function resetRpcClients(): void {
  clients.clear();
}
