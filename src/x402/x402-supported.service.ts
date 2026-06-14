import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ValkeyService } from "../valkey/valkey.service";
import {
  X402_HTTP_CLIENT,
  DEFAULT_CIRCLE_X402_SUPPORTED_URL,
  X402_CACHE_KEY,
  X402_CACHE_TTL_SECONDS,
  X402_REFRESH_INTERVAL_MS,
} from "./x402.constants";
import type {
  IX402HttpClient,
  TX402ChainEntry,
  TX402SupportedKind,
  TX402SupportedResponse,
} from "./x402-supported.types";

/**
 * Caches Circle's `GET /gateway/v1/x402/supported` response at boot and
 * refreshes every 12 hours.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.5, §6.7. Also task 22.
 *
 * Strategy:
 *  - L1: in-memory snapshot keyed by `chainId` → {@link TX402ChainEntry}.
 *        This is the hot path — every intent creation calls
 *        `getSupportedForChain` and cannot afford a Redis hop.
 *  - L2: Valkey (`x402:supported`) with 24 h TTL so a restart in the same
 *        pod fleet serves from the shared cache instead of hitting Circle
 *        from every pod.
 *
 * Boot never blocks (spec: "do not block boot"). The fetch fires via
 * `onApplicationBootstrap` and returns immediately; callers see an empty
 * map for the first few hundred ms while the response is in flight. That
 * matches the spec's "possibly empty for the first few seconds" rule.
 *
 * On fetch failure we log WARN and keep serving whatever's in L1/L2 — stale
 * data beats empty data because Circle's supported list rotates rarely.
 */
@Injectable()
export class X402SupportedService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(X402SupportedService.name);
  private readonly url: string;

  /** L1 in-memory lookup: chainId → entry (EVM only). */
  private byChainId: Map<number, TX402ChainEntry> = new Map();
  /** L1 in-memory lookup: CAIP-2 network string → entry (covers SVM too). */
  private byNetwork: Map<string, TX402ChainEntry> = new Map();
  /** Timestamp of last successful fetch, for observability. */
  private lastRefreshAt: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly abortController = new AbortController();

  constructor(
    private readonly configService: ConfigService,
    private readonly valkeyService: ValkeyService,
    @Inject(X402_HTTP_CLIENT) private readonly http: IX402HttpClient,
  ) {
    this.url = this.configService.get<string>(
      "CIRCLE_X402_SUPPORTED_URL",
      DEFAULT_CIRCLE_X402_SUPPORTED_URL,
    );
  }

  /**
   * Fires after all modules have initialized. We kick off the fetch in the
   * background and return immediately so Nest's bootstrap sequence isn't
   * blocked by Circle latency (or Circle being down).
   */
  onApplicationBootstrap(): void {
    // Prime from L2 (Valkey) synchronously-awaited, then kick the real fetch
    // in the background. The warm-from-Valkey step is itself wrapped in a
    // promise so boot doesn't wait on it either.
    void this.primeFromCache().then(() => {
      void this.refresh("boot");
    });

    // Schedule 12 h cron. setInterval is fine here: we don't need cron
    // expression precision, we need "~every 12 h while the pod is alive."
    // No new dep required (no @nestjs/schedule in package.json).
    this.refreshTimer = setInterval(
      () => void this.refresh("cron"),
      X402_REFRESH_INTERVAL_MS,
    );
    // Don't keep the event loop alive just for this timer.
    this.refreshTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.abortController.abort();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Hot-path lookup. Returns the Circle-supported x402 entry for a given
   * EVM chain ID, or `null` if Circle doesn't list it (or if the cache
   * hasn't primed yet).
   */
  getSupportedForChain(chainId: number): TX402ChainEntry | null {
    return this.byChainId.get(chainId) ?? null;
  }

  /**
   * CAIP-2 lookup — covers Solana entries where chainId doesn't apply.
   * Example: `getSupportedForNetwork("solana:mainnet")`.
   */
  getSupportedForNetwork(network: string): TX402ChainEntry | null {
    return this.byNetwork.get(network) ?? null;
  }

  /** All entries — used by `GET /v1/blockchains` enrichment. */
  getAll(): TX402ChainEntry[] {
    return Array.from(this.byChainId.values()).concat(
      Array.from(this.byNetwork.values()).filter(
        (e) => e.chainId === null, // dedupe: EVM entries are already in byChainId
      ),
    );
  }

  getLastRefreshAt(): number | null {
    return this.lastRefreshAt;
  }

  /**
   * Manual trigger (used by reactive refresh on settle errors — task 22
   * scope item 4 in the backlog file, lives here as the single refresh
   * entry point so the reactive path doesn't stampede Circle).
   */
  refreshNow(): Promise<boolean> {
    return this.refresh("manual");
  }

  private async refresh(source: "boot" | "cron" | "manual"): Promise<boolean> {
    try {
      const response = await this.http.get(this.url, this.abortController.signal);
      const entries = this.parseResponse(response);

      if (entries.length === 0) {
        this.logger.warn(
          `Circle x402 supported returned 0 valid entries (source=${source}) — keeping existing cache`,
        );
        return false;
      }

      // Swap L1 atomically — readers see either the old map or the new map,
      // never a half-populated one.
      const nextByChainId = new Map<number, TX402ChainEntry>();
      const nextByNetwork = new Map<string, TX402ChainEntry>();
      for (const entry of entries) {
        nextByNetwork.set(entry.network, entry);
        if (entry.chainId !== null) {
          nextByChainId.set(entry.chainId, entry);
        }
      }
      this.byChainId = nextByChainId;
      this.byNetwork = nextByNetwork;
      this.lastRefreshAt = Date.now();

      // Fire-and-forget L2 write. A Valkey failure here is not fatal — L1
      // serves traffic regardless.
      void this.writeToCache(entries).catch((err) => {
        this.logger.warn(
          `Failed to persist x402 supported to Valkey (source=${source}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      this.logger.log(
        `x402 supported refreshed (source=${source}): ${entries.length} entries cached`,
      );
      return true;
    } catch (err) {
      // Non-fatal per spec: "on boot failure, fall back to an empty list and
      // log a WARN. Do NOT block app startup." Same rule for cron.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to fetch Circle x402 supported (source=${source}): ${msg}`,
      );
      return false;
    }
  }

  /**
   * Load the previously-persisted Valkey snapshot. Used at boot so a pod
   * restart doesn't serve an empty map while waiting for the Circle fetch.
   */
  private async primeFromCache(): Promise<void> {
    try {
      const cached = await this.valkeyService.get<TX402ChainEntry[]>(
        X402_CACHE_KEY,
      );
      if (!cached || !Array.isArray(cached) || cached.length === 0) return;

      for (const entry of cached) {
        if (!entry || typeof entry !== "object") continue;
        this.byNetwork.set(entry.network, entry);
        if (entry.chainId !== null && entry.chainId !== undefined) {
          this.byChainId.set(entry.chainId, entry);
        }
      }
      this.logger.log(
        `x402 supported primed from Valkey: ${cached.length} entries`,
      );
    } catch (err) {
      // Valkey might not be connected yet on boot — warn and move on.
      this.logger.warn(
        `Failed to prime x402 supported from Valkey: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async writeToCache(entries: TX402ChainEntry[]): Promise<void> {
    await this.valkeyService.set(X402_CACHE_KEY, entries, {
      ttl: X402_CACHE_TTL_SECONDS,
    });
  }

  /**
   * Parse Circle's response into our normalized shape. Skips malformed
   * entries (log WARN) rather than throwing, so one bad row doesn't drop
   * the whole cache.
   */
  private parseResponse(response: TX402SupportedResponse): TX402ChainEntry[] {
    if (!response || !Array.isArray(response.kinds)) {
      this.logger.warn(
        "Circle x402 supported: malformed response (missing `kinds` array)",
      );
      return [];
    }

    const out: TX402ChainEntry[] = [];
    for (const kind of response.kinds) {
      const entry = this.parseKind(kind);
      if (entry) out.push(entry);
    }
    return out;
  }

  private parseKind(kind: TX402SupportedKind): TX402ChainEntry | null {
    if (!kind || typeof kind.network !== "string" || !kind.scheme) {
      return null;
    }

    const { namespace, chainId } = this.parseNetwork(kind.network);
    if (!namespace) return null;

    // EVM: `verifyingContract` MUST be valid 20-byte hex. Spec §13 #2:
    // "validate `verifyingContract` is a 20-byte hex; log and skip if
    // malformed." This is the mobile's EIP-712 domain — a bad value here
    // would corrupt every signature mobile produces against this chain.
    let verifyingContract: string | null = null;
    if (namespace === "eip155") {
      const candidate = kind.extra?.verifyingContract;
      if (candidate && this.isValid20ByteHex(candidate)) {
        verifyingContract = candidate.toLowerCase();
      } else if (candidate) {
        this.logger.warn(
          `x402 supported: skipping EVM entry for network=${kind.network} — invalid verifyingContract: ${candidate}`,
        );
        return null;
      }
    }

    return {
      namespace,
      chainId,
      network: kind.network,
      scheme: kind.scheme,
      asset: typeof kind.asset === "string" ? kind.asset : null,
      domainName: kind.extra?.name ?? null,
      domainVersion: kind.extra?.version ?? null,
      verifyingContract,
      authorizedSigners: Array.isArray(kind.authorizedSigners)
        ? kind.authorizedSigners.filter((s) => typeof s === "string")
        : [],
    };
  }

  /**
   * Parse `eip155:<chainId>` or `solana:<cluster>` CAIP-2 strings. Returns
   * `{ namespace: null, chainId: null }` on malformed input so the caller
   * can skip the entry.
   */
  private parseNetwork(network: string): {
    namespace: "eip155" | "solana" | string | null;
    chainId: number | null;
  } {
    const idx = network.indexOf(":");
    if (idx <= 0) return { namespace: null, chainId: null };

    const namespace = network.slice(0, idx);
    const reference = network.slice(idx + 1);

    if (namespace === "eip155") {
      const chainId = Number.parseInt(reference, 10);
      if (!Number.isFinite(chainId) || chainId <= 0) {
        return { namespace: null, chainId: null };
      }
      return { namespace, chainId };
    }

    if (namespace === "solana") {
      return { namespace, chainId: null };
    }

    // Unknown namespace — still track it so ops can see what Circle adds,
    // but `chainId` stays null.
    return { namespace, chainId: null };
  }

  private isValid20ByteHex(value: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(value);
  }
}
