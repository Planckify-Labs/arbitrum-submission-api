import { Injectable, Logger } from "@nestjs/common";
import type {
  IX402HttpClient,
  TX402SupportedResponse,
} from "./x402-supported.types";

/**
 * Default HTTP client for Circle's x402 supported endpoint.
 *
 * Uses the global `fetch` (available on Node ≥ 18 / ≥ 20). Tests inject a
 * mock that implements {@link IX402HttpClient} — no `nock`, no undici stub.
 *
 * Failure discipline (spec §6.5, task 22):
 * - Never throw a non-Error; always surface `{ name, message }` so the caller
 *   can log cleanly.
 * - 10 s default timeout via AbortController so we don't hang boot if Circle
 *   is slow.
 */
@Injectable()
export class X402HttpClient implements IX402HttpClient {
  private readonly logger = new Logger(X402HttpClient.name);
  private readonly timeoutMs = 10_000;

  async get(url: string, signal?: AbortSignal): Promise<TX402SupportedResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // Chain the caller's abort signal so service-level cancellation (e.g.
    // on module destroy) also aborts the in-flight request.
    const onParentAbort = () => controller.abort();
    signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Circle x402 supported: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const json = (await response.json()) as TX402SupportedResponse;
      return json;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
  }
}
