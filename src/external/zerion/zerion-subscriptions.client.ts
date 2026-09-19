import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Zerion "Subscriptions to transactions" — the control plane behind the
 * wallet-activity webhook (developers.zerion.io/webhooks). Deliberately NOT
 * part of `ZerionClient`: these are a handful of calls a day that manage
 * our subscription, and they must not compete with (or be refused by) the
 * portfolio daily budget, nor be cached.
 *
 * Every method throws on a non-2xx: callers are a cron and a BullMQ job,
 * both of which retry, so surfacing the failure is the right behaviour.
 */

export interface ZerionTxSubscription {
  id: string;
  callbackUrl: string;
  chainIds: string[];
}

/** Max addresses per request on every wallet endpoint. */
export const ZERION_WALLETS_PER_REQUEST = 100;

export class ZerionApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`Zerion ${path} → HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "ZerionApiError";
  }

  /** A retry with the same key/payload cannot succeed. */
  get permanent(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 400;
  }
}

@Injectable()
export class ZerionSubscriptionsClient {
  private readonly logger = new Logger(ZerionSubscriptionsClient.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("ZERION_API_KEY") || undefined;
    this.baseUrl = (
      this.configService.get<string>("ZERION_API_URL") ??
      "https://api.zerion.io/v1"
    ).replace(/\/+$/, "");
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  async listSubscriptions(): Promise<ZerionTxSubscription[]> {
    const body = await this.request<{ data?: RawSubscription[] }>(
      "GET",
      "/tx-subscriptions/",
    );
    return (body.data ?? []).map(toSubscription);
  }

  async createSubscription(input: {
    callbackUrl: string;
    addresses: string[];
    chainIds: string[];
  }): Promise<ZerionTxSubscription> {
    const body = await this.request<{ data: RawSubscription }>(
      "POST",
      "/tx-subscriptions/",
      {
        callback_url: input.callbackUrl,
        addresses: input.addresses.slice(0, ZERION_WALLETS_PER_REQUEST),
        chain_ids: input.chainIds,
      },
    );
    return toSubscription(body.data);
  }

  /** Every wallet the subscription monitors, walking `links.next`. */
  async listWallets(subscriptionId: string): Promise<string[]> {
    const out: string[] = [];
    let path: string | null =
      `/tx-subscriptions/${encodeURIComponent(subscriptionId)}/wallets?page[size]=2000`;
    let guard = 0;
    while (path && guard++ < 1000) {
      const body: {
        data?: Array<{ id?: string; attributes?: { address?: string } }>;
        links?: { next?: string | null };
      } = await this.request("GET", path);
      for (const item of body.data ?? []) {
        const address = item.attributes?.address ?? item.id;
        if (typeof address === "string" && address) out.push(address);
      }
      path = body.links?.next ? this.relativePath(body.links.next) : null;
    }
    return out;
  }

  async countWallets(subscriptionId: string): Promise<number | null> {
    try {
      const body = await this.request<{
        data?: { attributes?: { count?: number } };
      }>(
        "GET",
        `/tx-subscriptions/${encodeURIComponent(subscriptionId)}/wallets/count`,
      );
      const n = body.data?.attributes?.count;
      return typeof n === "number" ? n : null;
    } catch (err) {
      this.logger.debug(
        `[countWallets] unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Add/remove in batches of 100 (the API's per-request cap). */
  async patchWallets(
    subscriptionId: string,
    change: { add?: string[]; remove?: string[] },
  ): Promise<void> {
    const add = [...new Set(change.add ?? [])];
    const remove = [...new Set(change.remove ?? [])];
    const rounds = Math.max(
      Math.ceil(add.length / ZERION_WALLETS_PER_REQUEST),
      Math.ceil(remove.length / ZERION_WALLETS_PER_REQUEST),
    );
    for (let i = 0; i < rounds; i++) {
      const from = i * ZERION_WALLETS_PER_REQUEST;
      const to = from + ZERION_WALLETS_PER_REQUEST;
      const payload: { add?: string[]; remove?: string[] } = {};
      const addSlice = add.slice(from, to);
      const removeSlice = remove.slice(from, to);
      if (addSlice.length > 0) payload.add = addSlice;
      if (removeSlice.length > 0) payload.remove = removeSlice;
      await this.request(
        "PATCH",
        `/tx-subscriptions/${encodeURIComponent(subscriptionId)}/wallets`,
        payload,
      );
    }
  }

  /** Replaces the chain list outright. */
  async updateChainIds(
    subscriptionId: string,
    chainIds: string[],
  ): Promise<void> {
    await this.request(
      "PATCH",
      `/tx-subscriptions/${encodeURIComponent(subscriptionId)}/chain_ids`,
      { chain_ids: chainIds },
    );
  }

  async enable(subscriptionId: string): Promise<void> {
    await this.request(
      "PATCH",
      `/tx-subscriptions/${encodeURIComponent(subscriptionId)}/enable`,
    );
  }

  // ─── transport ────────────────────────────────────────────────────────────

  private async request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("ZERION_API_KEY not configured");
    }
    const url = `${this.baseUrl}${path}`;
    const started = Date.now();
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ZerionApiError(response.status, path, text.slice(0, 300));
    }
    this.logger.debug(
      `[zerion-subscriptions] ${method} ${path} ok in ${Date.now() - started}ms`,
    );
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  /** `links.next` is absolute; the transport wants a path under baseUrl. */
  private relativePath(next: string): string | null {
    try {
      const u = new URL(next);
      const base = new URL(this.baseUrl);
      const prefix = base.pathname.replace(/\/+$/, "");
      const p = u.pathname.startsWith(prefix)
        ? u.pathname.slice(prefix.length)
        : u.pathname;
      return `${p}${u.search}`;
    } catch {
      return null;
    }
  }
}

interface RawSubscription {
  id: string;
  attributes?: { callback_url?: string };
  relationships?: {
    chains?: Array<{ data?: { id?: string } }>;
  };
}

function toSubscription(raw: RawSubscription): ZerionTxSubscription {
  return {
    id: raw.id,
    callbackUrl: raw.attributes?.callback_url ?? "",
    chainIds: (raw.relationships?.chains ?? [])
      .map((c) => c.data?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  };
}
