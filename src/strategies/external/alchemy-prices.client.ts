import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ValkeyService } from "../../valkey/valkey.service";

const DEFAULT_DAILY_BUDGET_REQUESTS = 5000;
const PRICE_CACHE_TTL_SECONDS = 60;
const ALCHEMY_PRICES_BASE_URL = "https://api.g.alchemy.com/prices/v1";
/** Alchemy's own per-request limits (Prices API docs). */
const MAX_ADDRESSES_PER_CALL = 25;
const MAX_SYMBOLS_PER_CALL = 25;

// Alchemy's chain-slug vocabulary is shared with the Token API client; the
// map lives in `alchemy/alchemy-networks.ts`. Re-exported here so existing
// importers of this module keep working.
export { alchemyNetworkForChainId } from "../../alchemy/alchemy-networks";

interface AlchemyPriceEntry {
  currency: string;
  value: string;
  lastUpdatedAt: string;
}

interface AlchemyBySymbolRow {
  symbol: string;
  prices: AlchemyPriceEntry[];
  error: string | null;
}

interface AlchemyByAddressRow {
  network: string;
  address: string;
  prices: AlchemyPriceEntry[];
  error: string | null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Unwrap undici's generic `TypeError: fetch failed` to surface DNS/conn codes. */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === "AbortError") return "request aborted (timeout)";
  const parts: string[] = [err.message || err.name];
  let cause: unknown = (err as { cause?: unknown }).cause;
  while (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const syscall = (cause as NodeJS.ErrnoException).syscall;
    const hostname = (cause as { hostname?: string }).hostname;
    const tag = [code, hostname, syscall].filter(Boolean).join(" ");
    parts.push(tag ? `${cause.message} (${tag})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(" → ");
}

function usdValue(prices: AlchemyPriceEntry[]): number | null {
  const usd = prices.find((p) => p.currency.toUpperCase() === "USD");
  if (!usd) return null;
  const parsed = Number(usd.value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `ValkeyService.get`/`set` JSON-encode whatever is stored (`set` calls
 * `JSON.stringify` on objects; `get` calls `JSON.parse` on read and falls
 * back to the raw string only if that throws). A bare string sentinel like
 * `"null"` round-trips as the *value* `null`, not the string — which reads
 * back as a cache MISS, defeating the point of caching a "no price" result.
 * Storing `{ usd }` sidesteps the ambiguity entirely.
 */
interface CachedPrice {
  usd: number | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Server-side proxy for Alchemy's Prices API — the missing USD spot-price
 * source for DeFi position valuation (docs/defi-evm-protocol-expansion-spec.md
 * §9 "readPosition returns correct underlying-unit balance"; pricing that raw
 * balance into USD was never wired up anywhere in the app).
 *
 * Mirrors `ZerionClient`'s shape: `ConfigService`-sourced key, Valkey-backed
 * cache + daily budget, `describeFetchError` unwrapping. The key never
 * reaches the mobile client — same posture documented in
 * `blockchains/rpc-endpoint.ts` for the RPC provider key.
 */
@Injectable()
export class AlchemyPricesClient {
  private readonly logger = new Logger(AlchemyPricesClient.name);
  private readonly apiKey: string | null;
  private readonly dailyBudget: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly valkeyService: ValkeyService,
  ) {
    this.apiKey =
      this.configService.get<string>("ALCHEMY_API_KEY") ??
      // Deploy-order fallback: the key was product-scoped before the Token
      // API started sharing it. Remove once every environment is renamed.
      this.configService.get<string>("ALCHEMY_PRICES_API_KEY") ??
      null;
    if (!this.apiKey) {
      this.logger.warn(
        "ALCHEMY_API_KEY not configured — asset prices will resolve to null.",
      );
    }
    const budget = Number(
      this.configService.get<string>("DEFI_ALCHEMY_PRICES_DAILY_BUDGET_REQUESTS"),
    );
    this.dailyBudget =
      Number.isFinite(budget) && budget > 0
        ? Math.floor(budget)
        : DEFAULT_DAILY_BUDGET_REQUESTS;
  }

  private getRateLimitKey(): string {
    const today = new Date().toISOString().split("T")[0];
    return `alchemy-prices:ratelimit:${today}`;
  }

  private async checkAndIncrementBudget(): Promise<boolean> {
    const key = this.getRateLimitKey();
    const countStr = await this.valkeyService.get<string>(key);
    let count = countStr ? parseInt(countStr, 10) : 0;

    if (count >= this.dailyBudget) {
      this.logger.warn(
        `Alchemy Prices daily budget of ${this.dailyBudget} requests exceeded.`,
      );
      return false;
    }

    count++;
    await this.valkeyService.set(key, count.toString(), { ttl: 86400 });
    return true;
  }

  private cacheKeyForAddress(network: string, address: string): string {
    return `alchemy-prices:addr:${network}:${address.toLowerCase()}`;
  }

  private cacheKeyForSymbol(symbol: string): string {
    return `alchemy-prices:sym:${symbol.toUpperCase()}`;
  }

  /**
   * Prices for ERC-20/SPL-style tokens by (network, contract address).
   * Returns a map keyed by `${network}:${address.toLowerCase()}` -> USD
   * price, or `null` when Alchemy has no price / the request failed. Missing
   * pairs are simply absent from the map (never thrown) so a partial-price
   * batch never fails the whole caller.
   */
  async getPricesByAddress(
    pairs: { network: string; address: string }[],
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    if (pairs.length === 0) return result;

    const uncached: { network: string; address: string }[] = [];
    for (const pair of pairs) {
      const key = this.cacheKeyForAddress(pair.network, pair.address);
      const cached = await this.valkeyService
        .get<CachedPrice>(key)
        .catch(() => null);
      if (cached !== null) {
        result.set(`${pair.network}:${pair.address.toLowerCase()}`, cached.usd);
      } else {
        uncached.push(pair);
      }
    }
    if (uncached.length === 0) return result;

    if (!this.apiKey) {
      for (const pair of uncached) {
        result.set(`${pair.network}:${pair.address.toLowerCase()}`, null);
      }
      return result;
    }

    for (const batch of chunk(uncached, MAX_ADDRESSES_PER_CALL)) {
      const hasBudget = await this.checkAndIncrementBudget();
      if (!hasBudget) {
        for (const pair of batch) {
          result.set(`${pair.network}:${pair.address.toLowerCase()}`, null);
        }
        continue;
      }
      try {
        const response = await fetch(
          `${stripTrailingSlash(ALCHEMY_PRICES_BASE_URL)}/${this.apiKey}/tokens/by-address`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addresses: batch }),
          },
        );
        if (!response.ok) {
          throw new Error(`Alchemy Prices API error: ${response.statusText}`);
        }
        const body = (await response.json()) as { data: AlchemyByAddressRow[] };
        for (const row of body.data ?? []) {
          const key = `${row.network}:${row.address.toLowerCase()}`;
          const usd = row.error ? null : usdValue(row.prices ?? []);
          result.set(key, usd);
          await this.valkeyService
            .set(
              this.cacheKeyForAddress(row.network, row.address),
              { usd } satisfies CachedPrice,
              { ttl: PRICE_CACHE_TTL_SECONDS },
            )
            .catch(() => undefined);
        }
      } catch (error: unknown) {
        this.logger.error(
          `[getPricesByAddress] Alchemy request failed: ${describeFetchError(error)}`,
        );
        for (const pair of batch) {
          result.set(`${pair.network}:${pair.address.toLowerCase()}`, null);
        }
      }
    }

    return result;
  }

  /**
   * Prices for native coins (ETH, …) by symbol — Alchemy's by-address
   * endpoint can't price a coin with no contract. Returns a map keyed by
   * uppercased symbol -> USD price (or `null`).
   */
  async getPricesBySymbol(symbols: string[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    if (symbols.length === 0) return result;

    const uncached: string[] = [];
    for (const symbol of symbols) {
      const key = this.cacheKeyForSymbol(symbol);
      const cached = await this.valkeyService
        .get<CachedPrice>(key)
        .catch(() => null);
      if (cached !== null) {
        result.set(symbol.toUpperCase(), cached.usd);
      } else {
        uncached.push(symbol);
      }
    }
    if (uncached.length === 0) return result;

    if (!this.apiKey) {
      for (const symbol of uncached) result.set(symbol.toUpperCase(), null);
      return result;
    }

    for (const batch of chunk(uncached, MAX_SYMBOLS_PER_CALL)) {
      const hasBudget = await this.checkAndIncrementBudget();
      if (!hasBudget) {
        for (const symbol of batch) result.set(symbol.toUpperCase(), null);
        continue;
      }
      try {
        const params = new URLSearchParams();
        for (const symbol of batch) params.append("symbols", symbol);
        const response = await fetch(
          `${stripTrailingSlash(ALCHEMY_PRICES_BASE_URL)}/${this.apiKey}/tokens/by-symbol?${params.toString()}`,
        );
        if (!response.ok) {
          throw new Error(`Alchemy Prices API error: ${response.statusText}`);
        }
        const body = (await response.json()) as { data: AlchemyBySymbolRow[] };
        for (const row of body.data ?? []) {
          const usd = row.error ? null : usdValue(row.prices ?? []);
          result.set(row.symbol.toUpperCase(), usd);
          await this.valkeyService
            .set(
              this.cacheKeyForSymbol(row.symbol),
              { usd } satisfies CachedPrice,
              { ttl: PRICE_CACHE_TTL_SECONDS },
            )
            .catch(() => undefined);
        }
      } catch (error: unknown) {
        this.logger.error(
          `[getPricesBySymbol] Alchemy request failed: ${describeFetchError(error)}`,
        );
        for (const symbol of batch) result.set(symbol.toUpperCase(), null);
      }
    }

    return result;
  }
}
