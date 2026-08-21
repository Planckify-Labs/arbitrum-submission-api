/**
 * Candidate addresses from each protocol's OWN API (spec §11.6, §12 Q7).
 *
 * ## Why this exists
 *
 * DeFiLlama's `/poolsOld` — the one place a pool UUID could be turned into an
 * address for families with no on-chain registry — now answers **HTTP 402**.
 * Every family that depended on it resolves nothing (§11.5b).
 *
 * The fix is the one §11.6 already prescribes: ask the protocol, not an
 * aggregator. DeFiLlama's own yield-server does exactly that — each
 * `src/adaptors/<slug>/index.js` calls the protocol's public API and reads the
 * vault address out of the response. This file brings that extraction in-house,
 * so the address is fetched live from the source of truth instead of being
 * looked up in a third party's snapshot of it.
 *
 * ## Why an API here is allowed, when Zerion was not
 *
 * §12 Q7 draws the line at *authority*, not at "API vs on-chain": a per-vault
 * address may come from **the protocol's own** API, because a protocol is
 * authoritative about which vaults it deployed. A third-party token search is
 * not — measured 2026-08-19, searching Zerion for `yoUSD` returned YieldFi's
 * `yUSD`, a different protocol's vault that shares the same `asset()` and so
 * passes validation. An authoritative endpoint cannot make that mistake.
 *
 * ## What still gates it
 *
 * Nothing here is trusted. The address is a **candidate**: `ctx.validate` reads
 * `asset()` on chain and requires it to equal the pool's underlying before any
 * target is emitted, and `matchVault` refuses to guess between siblings. A
 * compromised or wrong API response fails closed to Manual, exactly as a wrong
 * `/poolsOld` row did.
 *
 * Adding a protocol is one `registerProtocol({ discovery: { via: "protocol-api" … } })`
 * entry in `protocols.ts`. Find its endpoint
 * the same way this file's entries were found: read
 * `DefiLlama/yield-server/src/adaptors/<slug>/index.js`, which names the
 * protocol's endpoint and the field the address lives in. **Read it as
 * documentation, not as code to copy — that repo ships no LICENSE file**
 * (verified 2026-08-19: `LICENSE` 404, GitHub reports no license).
 */

import type { DeFiLlamaYieldPool } from "../../external/defillama.client";
import type { Address, ResolverContext } from "../types";
import { resolveEvmChainId } from "../types";
import {
  type VaultRow,
  cachedVaults,
  describeVaults,
  matchVault,
} from "./onchain.source";
import type { CandidateSource } from "./registry";

/** How long a protocol's vault list is cached. Vault sets change slowly. */
const API_TTL_SEC = 30 * 60;

export interface ProtocolApiSpec {
  /** Cache-key namespace; also the label in logs. */
  readonly family: string;
  /** DeFiLlama `project` slugs this spec serves. */
  readonly projects: readonly string[];
  /** Endpoint for a chain, or `null` when the protocol is not deployed there. */
  url(chainId: number): string | null;
  /** Request init, for endpoints that are GraphQL rather than REST. */
  init?(chainId: number): {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  /** Normalise the payload into vault rows for THIS chain. Must not throw. */
  rows(payload: unknown, chainId: number): VaultRow[];
}

export function addr(value: unknown): Address | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value.toLowerCase() as Address)
    : null;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Build a `CandidateSource` from one protocol's API spec.
 *
 * One source per protocol rather than one shared source with a lookup table:
 * the health tracker keys on `source.id`, so a per-protocol id is what makes
 * "yo's endpoint went dark" a distinguishable signal instead of an aggregate.
 */
const warned = new Set<string>();

/** One line per protocol per process — a signal, not a per-pool log flood. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/**
 * Does this payload look like the endpoint refusing rather than answering?
 * Deliberately shape-based: every REST API disagrees about wording, but they
 * agree about carrying an `error`/`statusCode`/`message` instead of data.
 */
function isErrorPayload(payload: unknown): boolean {
  const p = rec(payload);
  if (Array.isArray(payload)) return false;
  const hasError = "error" in p || "errors" in p;
  const status = Number(p.statusCode ?? p.status);
  return hasError || (Number.isFinite(status) && status >= 400);
}

function describeError(payload: unknown): string {
  const p = rec(payload);
  const status = p.statusCode ?? p.status;
  const message = Array.isArray(p.message)
    ? p.message.join("; ")
    : (str(p.message) ?? str(p.error) ?? "no detail");
  return status ? `status ${status}: ${message}` : message;
}

export function protocolApiSource(spec: ProtocolApiSpec): CandidateSource {
  return {
    id: `protocol-api:${spec.family}`,
    projects: spec.projects,
    async candidate(
      pool: DeFiLlamaYieldPool,
      ctx: ResolverContext,
    ): Promise<Address | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) {
        // EVM-ONLY, and loudly so.
        //
        // `CandidateSource` returns `Address` (`0x${string}`), which a Sui
        // object id or a Solana pubkey cannot be. A non-EVM protocol declared
        // through the manifest would therefore resolve NOTHING, silently, for
        // the same reason `/poolsOld` did — and that silence is the failure
        // class this file exists to remove. Say it instead.
        //
        // Docking a namespace here is widening the candidate identifier to a
        // namespace-neutral string and letting each resolver narrow it, NOT
        // branching on namespace. Until then, non-EVM protocols resolve through
        // their own resolvers (scallop, navi, ember, suilst), which call the
        // protocol's API directly and never enter this layer.
        warnOnce(
          `${spec.family}:non-evm`,
          `[protocol-api:${spec.family}] "${pool.chain}" is not an EVM chain. ` +
            `This discovery layer is EVM-only, so every pool here stays Manual. ` +
            `Non-EVM protocols need their own resolver (see scallop.resolver.ts).`,
        );
        return null;
      }

      const url = spec.url(chainId);
      if (!url) return null;

      const payload = await ctx.fetchJsonCached<unknown>(
        `defillama:targets:protocol-api:${spec.family}:${chainId}:v1`,
        url,
        API_TTL_SEC,
        spec.init?.(chainId),
      );
      if (!payload) {
        // `fetchJsonCached` returns null for ANY non-2xx and logs the status
        // through Nest, which is easy to miss in a long run. Say it once here
        // too, attributed to the protocol, because "the endpoint refused" and
        // "this protocol has no pools of ours" are the same silence otherwise —
        // and that silence is exactly what hid the Pendle `limit=500` bug
        // (HTTP 400, zero rows, read as no coverage).
        warnOnce(
          spec.family,
          `[protocol-api:${spec.family}] no data from ${url}. Every pool for ` +
            `this protocol resolves to Manual until it answers.`,
        );
        return null;
      }

      // An ERROR-SHAPED payload is not an empty result, and the difference
      // matters: Pendle answers HTTP 400 with `{message, error, statusCode}`
      // when `limit` exceeds 100, `rows()` finds no `results` key, and the
      // source yields zero — indistinguishable from "this protocol has no
      // pools of ours". That shipped, and only the DARK health signal caught
      // it. Naming the shape turns a silent zero into a stated reason.
      if (isErrorPayload(payload)) {
        warnOnce(
          spec.family,
          `[protocol-api:${spec.family}] endpoint returned an error payload, not data ` +
            `(${describeError(payload)}). Every pool for this protocol will be Manual.`,
        );
        return null;
      }

      let rows: VaultRow[];
      try {
        rows = spec.rows(payload, chainId);
      } catch {
        // A shape change is "no candidate", never a thrown resolve (§4 contract).
        return null;
      }
      if (rows.length === 0) return null;

      return matchVault(rows, pool);
    },
  };
}

// ── Addresses from the API, asset from the chain ────────────────────────────

export interface ProtocolApiAddressSpec {
  readonly family: string;
  readonly projects: readonly string[];
  url(chainId: number): string | null;
  init?(chainId: number): {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  /** Every vault address this payload lists for THIS chain. Must not throw. */
  addresses(payload: unknown, chainId: number): Address[];
}

/**
 * For protocols whose API lists **addresses but not assets**.
 *
 * Concrete is the case: `apy.api.concrete.xyz/v1/vault:tvl/all` returns
 * `{ [chainId]: { [key]: { address, name, symbol } } }` with no asset anywhere,
 * because DeFiLlama's adaptor multicalls `asset()` itself. Forcing that through
 * `ProtocolApiSpec` would mean inventing an asset, and inventing is the one
 * thing a candidate source must never do.
 *
 * So the split is by authority, and it is the better arrangement anyway: the
 * API is authoritative for **which contracts exist**, the chain is
 * authoritative for **what each one holds**. `describeVaults` reads
 * `asset`/`symbol`/`name` on chain, and a vault whose reads fail is dropped
 * rather than defaulted.
 *
 * The on-chain describe is the expensive half, so it is cached per family and
 * chain, and an empty result is never cached (a transient RPC failure must not
 * blind the family for the whole window).
 */
export function protocolApiVaultSource(
  spec: ProtocolApiAddressSpec,
): CandidateSource {
  return {
    id: `protocol-api:${spec.family}`,
    projects: spec.projects,
    async candidate(
      pool: DeFiLlamaYieldPool,
      ctx: ResolverContext,
    ): Promise<Address | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId) {
        warnOnce(
          `${spec.family}:non-evm`,
          `[protocol-api:${spec.family}] "${pool.chain}" is not an EVM chain. ` +
            `This discovery layer is EVM-only, so every pool here stays Manual.`,
        );
        return null;
      }
      const client = ctx.publicClient?.(chainId);
      if (!client) return null;

      const url = spec.url(chainId);
      if (!url) return null;

      const payload = await ctx.fetchJsonCached<unknown>(
        `defillama:targets:protocol-api:${spec.family}:${chainId}:v1`,
        url,
        API_TTL_SEC,
        spec.init?.(chainId),
      );
      if (!payload) {
        warnOnce(
          spec.family,
          `[protocol-api:${spec.family}] no data from ${url}. Every pool for ` +
            `this protocol resolves to Manual until it answers.`,
        );
        return null;
      }
      if (isErrorPayload(payload)) {
        warnOnce(
          spec.family,
          `[protocol-api:${spec.family}] endpoint returned an error payload, not data ` +
            `(${describeError(payload)}). Every pool for this protocol will be Manual.`,
        );
        return null;
      }

      let addresses: Address[];
      try {
        addresses = spec.addresses(payload, chainId);
      } catch {
        return null;
      }
      if (addresses.length === 0) {
        warnOnce(
          `${spec.family}:no-addresses`,
          `[protocol-api:${spec.family}] answered, but no vault addresses were ` +
            `read out of the payload for chain ${chainId}. Either this chain has ` +
            `no vaults or the response shape moved — check before assuming the former.`,
        );
        return null;
      }

      const rows = await cachedVaults(`${spec.family}:${chainId}`, () =>
        describeVaults(client, addresses),
      );
      if (rows.length === 0) return null;
      return matchVault(rows, pool);
    },
  };
}
