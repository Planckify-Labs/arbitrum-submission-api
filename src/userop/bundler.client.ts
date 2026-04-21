import { Injectable, Logger } from "@nestjs/common";

/**
 * Shape of a JSON-RPC 2.0 response envelope that a bundler returns for
 * `eth_sendUserOperation`. Both `result` and `error` are mutually exclusive
 * per the JSON-RPC spec; we model the union explicitly so the service layer
 * can switch on presence without an ad-hoc `in` check.
 *
 * Error fields mirror the bundler-provider convention (Pimlico / Alchemy /
 * Stackup all conform to JSON-RPC 2.0 shape — `code` is an integer, `message`
 * a string, `data` optional opaque).
 */
interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result: T;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

/**
 * Outcome of a bundler round-trip. Discriminated union so callers must
 * handle every branch — each has a distinct HTTP-status mapping.
 *
 *  - `ok`       → 200 to client with the bundler's userOpHash.
 *  - `rejected` → bundler returned a JSON-RPC error. Echo verbatim as 4xx
 *                 (bundler-side validation — signature invalid, nonce gap,
 *                 paymaster rejected, etc.).
 *  - `upstream` → bundler returned non-2xx HTTP or a non-JSON body. Echo as
 *                 5xx (bundler outage, not a user error).
 *  - `timeout`  → the 30 s AbortController tripped. Surface as 504 so the
 *                 mobile client can retry without treating it as a hard fail.
 */
export type BundlerOutcome =
  | { kind: "ok"; userOpHash: `0x${string}`; httpStatus: number }
  | {
      kind: "rejected";
      httpStatus: number;
      rpcCode: number;
      rpcMessage: string;
      rpcData?: unknown;
    }
  | {
      kind: "upstream";
      httpStatus: number | null;
      message: string;
      body: unknown;
    }
  | { kind: "timeout"; message: string };

export interface IBundlerClient {
  sendUserOperation(args: {
    bundlerUrl: string;
    userOp: unknown;
    entryPoint: `0x${string}`;
    chainId: number;
    signal?: AbortSignal;
  }): Promise<BundlerOutcome>;
}

/** DI token so tests can inject a stub instead of the real HTTP client. */
export const BUNDLER_CLIENT = "BUNDLER_CLIENT";

/**
 * Per user-prompt scope: "Timeout 30s. Bundler response is usually <5s but
 * include a margin." The ERC-4337 simulation phase (validateUserOp +
 * validatePaymasterUserOp) can spike past 10s on congested L2s, so the
 * 30s cap absorbs realistic tail latency without making the mobile client
 * wait forever.
 */
export const BUNDLER_TIMEOUT_MS = 30_000;

/**
 * Default implementation — plain `fetch` + AbortController. No SDK
 * dependency so we can target any JSON-RPC-compatible bundler (Alchemy,
 * Pimlico, Stackup, …) — the URL is resolved per-chain from
 * `Blockchain.bundlerUrl` by `UserOpService`.
 *
 * Why not `permissionless` on the server? The lib is oriented around
 * client-side UserOp *building*, which we deliberately do NOT do here —
 * the mobile adapter (task 35) owns that responsibility. Server-side we
 * only forward bytes; the dependency would be dead weight.
 */
@Injectable()
export class BundlerClient implements IBundlerClient {
  private readonly logger = new Logger(BundlerClient.name);

  async sendUserOperation(args: {
    bundlerUrl: string;
    userOp: unknown;
    entryPoint: `0x${string}`;
    chainId: number;
    signal?: AbortSignal;
  }): Promise<BundlerOutcome> {
    const { bundlerUrl, userOp, entryPoint, signal: parentSignal } = args;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUNDLER_TIMEOUT_MS);

    // Chain the parent abort (e.g. module shutdown) into our controller so
    // pod shutdown cancels in-flight bundler calls cleanly.
    const onParentAbort = () => controller.abort();
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    const body = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "eth_sendUserOperation",
      params: [userOp, entryPoint],
    };

    let httpStatus: number | null = null;
    try {
      const response = await fetch(bundlerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      httpStatus = response.status;

      let parsed: JsonRpcResponse<unknown> | null = null;
      try {
        parsed = (await response.json()) as JsonRpcResponse<unknown>;
      } catch {
        return {
          kind: "upstream",
          httpStatus,
          message: `Bundler returned non-JSON body (HTTP ${httpStatus})`,
          body: null,
        };
      }

      if (!parsed || typeof parsed !== "object") {
        return {
          kind: "upstream",
          httpStatus,
          message: `Bundler returned malformed JSON-RPC envelope (HTTP ${httpStatus})`,
          body: parsed,
        };
      }

      // JSON-RPC error branch. Echo verbatim at 4xx — bundler already told
      // us the user/UserOp is at fault, no additional server judgment
      // should layer on top.
      if ("error" in parsed && parsed.error) {
        return {
          kind: "rejected",
          httpStatus,
          rpcCode: parsed.error.code,
          rpcMessage: parsed.error.message,
          rpcData: parsed.error.data,
        };
      }

      // JSON-RPC success branch. Shape check the result — bundlers
      // canonically return a 32-byte hex string; anything else is garbage
      // we refuse to echo as "ok".
      if ("result" in parsed && typeof parsed.result === "string") {
        const candidate = parsed.result.toLowerCase();
        if (/^0x[0-9a-f]{64}$/.test(candidate)) {
          return {
            kind: "ok",
            userOpHash: candidate as `0x${string}`,
            httpStatus,
          };
        }
      }

      // Bundler replied 2xx with a non-error, non-valid-result payload —
      // treat as upstream malformation. Keep the raw body so ops can
      // diagnose it from logs.
      return {
        kind: "upstream",
        httpStatus,
        message: `Bundler returned unexpected JSON-RPC shape (HTTP ${httpStatus})`,
        body: parsed,
      };
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || controller.signal.aborted);
      if (isAbort) {
        return {
          kind: "timeout",
          message: `Bundler call timed out after ${BUNDLER_TIMEOUT_MS}ms`,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "upstream", httpStatus, message, body: null };
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }
}
