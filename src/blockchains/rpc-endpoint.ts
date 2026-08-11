/**
 * Resolves `Blockchain.rpcUrl` into something an RPC client can actually call.
 *
 * `rpcUrl` holds a *route* on the rpc-proxy ("/evm/1", "/solana/mainnet"), not
 * an absolute URL. The proxy origin and its bearer token live in env, which
 * means:
 *
 *   - Rotating the proxy domain or key is a redeploy, never a re-seed.
 *   - No upstream provider key (Alchemy et al.) reaches this database, and none
 *     reaches the `GET /blockchains` response — that route is `@Public()` and
 *     sets `Cache-Control: public`, which is precisely how the previous Alchemy
 *     key ended up published to every mobile client and any intermediary cache.
 *
 * Failover across providers happens inside rpc-proxy (see ../../rpc-proxy),
 * so callers here only ever know about one URL per chain.
 */

const ABSOLUTE_URL = /^https?:\/\//i;

export interface RpcEndpoint {
  /** Absolute URL to call. */
  url: string;
  /**
   * Headers required to reach `url`. Empty unless the request is actually
   * bound for our proxy — the proxy bearer must never be attached to a
   * passthrough upstream, or we would hand our token to a third party.
   */
  headers: Record<string, string>;
}

function proxyOrigin(): string | undefined {
  return process.env.RPC_PROXY_URL?.trim().replace(/\/+$/, "") || undefined;
}

function proxyHeaders(): Record<string, string> {
  const key = process.env.RPC_PROXY_API_KEY?.trim();
  // rpc-proxy disables auth entirely when its PROXY_API_KEY is unset (see
  // rpc-proxy/src/middleware/auth.ts), so an absent key here is a valid
  // configuration, not an error.
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * @param rpcUrl the raw `Blockchain.rpcUrl` column value
 * @throws when a proxy route is stored but `RPC_PROXY_URL` is not configured —
 *   loud at boot (verification services resolve during init) beats silently
 *   serving "/evm/1" to the mobile app as if it were a URL.
 */
export function resolveRpcEndpoint(rpcUrl: string): RpcEndpoint {
  const raw = rpcUrl.trim();

  // Rows seeded before the proxy cutover still hold absolute upstream URLs.
  // Pass them through untouched (and unauthenticated) so a stale row degrades
  // to "talks directly to the upstream" rather than producing a concatenated
  // nonsense URL like https://rpc.example.com/https://eth-mainnet...
  if (ABSOLUTE_URL.test(raw)) {
    return { url: raw, headers: {} };
  }

  const origin = proxyOrigin();
  if (!origin) {
    throw new Error(
      `Blockchain.rpcUrl is the proxy route "${raw}" but RPC_PROXY_URL is not set. ` +
        "Point it at the rpc-proxy deployment (e.g. https://rpc.takumipay.xyz).",
    );
  }

  return {
    url: `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`,
    headers: proxyHeaders(),
  };
}

/** Convenience for callers that only need the URL (e.g. API responses). */
export function resolveRpcUrl(rpcUrl: string): string {
  return resolveRpcEndpoint(rpcUrl).url;
}

/**
 * Returns `row` with `rpcUrl` resolved to an absolute URL.
 *
 * Apply at the response boundary, *after* any cache read: cached payloads then
 * stay origin-agnostic, so changing `RPC_PROXY_URL` takes effect immediately
 * instead of waiting out a Valkey TTL.
 */
export function withResolvedRpcUrl<T extends { rpcUrl: string }>(row: T): T {
  return { ...row, rpcUrl: resolveRpcUrl(row.rpcUrl) };
}
