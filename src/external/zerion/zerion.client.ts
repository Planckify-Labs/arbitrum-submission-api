import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValkeyService } from '../../valkey/valkey.service';
import {
  chainFromZerionId,
  resolveZerionChainIds,
  type ZerionCapability,
  type ZerionChainSelector,
} from './zerion.chains';
import {
  ZERION_POSITION_STATUSES,
  type DiscoveredAsset,
  type ZerionDefiPosition,
  type ZerionNftPosition,
  type ZerionPositionStatus,
  type ZerionResult,
} from './zerion.types';

const DEFAULT_DAILY_BUDGET_REQUESTS = 1000;

/** Cache lifetimes. These are a BACKSTOP, not the refresh mechanism — the
 *  user's pull-to-refresh (`refresh: true`) is the fresh path. */
const TTL_DISCOVERY_SECONDS = 12 * 60 * 60;
const TTL_DEFI_SECONDS = 60 * 60;
const TTL_NFT_SECONDS = 60 * 60;

/** Refresh throttle: one forced refresh per wallet per window, plus a daily
 *  ceiling, so one user holding pull-to-refresh cannot drain the shared quota. */
const REFRESH_MIN_INTERVAL_SECONDS = 30;
const REFRESH_DAILY_CEILING = 50;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function requireUrl(configService: ConfigService, name: string): string {
  const value = configService.get<string>(name);
  if (!value || !value.trim()) {
    throw new Error(
      `${name} is required (DeFi Strategies). Set it in your environment — see .env.example for the production default.`,
    );
  }
  return stripTrailingSlash(value.trim());
}

/** Unwrap undici's generic `TypeError: fetch failed` to surface DNS/conn codes. */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'request aborted (timeout)';
  const parts: string[] = [err.message || err.name];
  let cause: unknown = (err as { cause?: unknown }).cause;
  while (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const syscall = (cause as NodeJS.ErrnoException).syscall;
    const hostname = (cause as { hostname?: string }).hostname;
    const tag = [code, hostname, syscall].filter(Boolean).join(' ');
    parts.push(tag ? `${cause.message} (${tag})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(' → ');
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Outcome of one upstream call, before caching decisions. */
type RawFetch<T> =
  | { kind: 'ok'; body: T }
  | { kind: 'indexing' }
  /** Network error, non-2xx, or exhausted budget — caller degrades. */
  | { kind: 'unavailable'; reason: string };

export interface PortfolioQuery {
  /** Numeric chain ids and/or namespace strings ("solana"). */
  chains?: readonly ZerionChainSelector[];
  /** True only for a deliberate user gesture. Bypasses and overwrites cache. */
  refresh?: boolean;
}

export interface NftQuery extends PortfolioQuery {
  pageSize?: number;
  pageAfter?: string;
}

@Injectable()
export class ZerionClient {
  private readonly logger = new Logger(ZerionClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly dailyBudget: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly valkeyService: ValkeyService,
  ) {
    const key = this.configService.get<string>('ZERION_API_KEY');
    if (!key) {
      throw new Error('ZERION_API_KEY is required for DeFi Strategies.');
    }
    this.apiKey = key;
    this.baseUrl = requireUrl(this.configService, 'ZERION_API_URL');
    const budget = Number(
      this.configService.get<string>('DEFI_ZERION_DAILY_BUDGET_REQUESTS'),
    );
    this.dailyBudget =
      Number.isFinite(budget) && budget > 0
        ? Math.floor(budget)
        : DEFAULT_DAILY_BUDGET_REQUESTS;
  }

  // ─── Budget + throttle ────────────────────────────────────────────────────

  private getRateLimitKey(): string {
    const today = new Date().toISOString().split('T')[0];
    return `zerion:ratelimit:${today}`;
  }

  private async checkAndIncrementBudget(): Promise<boolean> {
    const key = this.getRateLimitKey();
    const countStr = await this.valkeyService.get<string>(key);
    let count = countStr ? parseInt(String(countStr), 10) : 0;

    if (count >= this.dailyBudget) {
      this.logger.warn(`Zerion daily budget of ${this.dailyBudget} requests exceeded.`);
      return false;
    }

    count++;
    await this.valkeyService.set(key, count.toString(), { ttl: 86400 });
    return true;
  }

  /**
   * Is this wallet allowed to force a refresh right now? A refused refresh is
   * NOT an error: the caller serves the cached entry and flags `throttled`, so
   * the screen still shows data.
   */
  private async allowRefresh(wallet: string): Promise<boolean> {
    const gateKey = `zerion:refresh:${wallet.toLowerCase()}`;
    const recent = await this.valkeyService.get<string>(gateKey);
    if (recent) return false;

    const today = new Date().toISOString().split('T')[0];
    const dayKey = `zerion:refreshday:${wallet.toLowerCase()}:${today}`;
    const usedStr = await this.valkeyService.get<string>(dayKey);
    const used = usedStr ? parseInt(String(usedStr), 10) : 0;
    if (used >= REFRESH_DAILY_CEILING) {
      this.logger.warn(
        `[allowRefresh] wallet hit the daily refresh ceiling (${REFRESH_DAILY_CEILING})`,
      );
      return false;
    }

    await this.valkeyService.set(gateKey, '1', {
      ttl: REFRESH_MIN_INTERVAL_SECONDS,
    });
    await this.valkeyService.set(dayKey, (used + 1).toString(), { ttl: 86400 });
    return true;
  }

  // ─── Transport ────────────────────────────────────────────────────────────

  /**
   * One place that owns auth, the budget check, 202 handling, and error
   * shaping. Every fetcher goes through here.
   *
   * The 202 branch is the reason this exists: `response.ok` is TRUE for 202
   * Accepted, so the previous per-method fetch bodies parsed a still-indexing
   * wallet's incomplete response as though it were final.
   */
  private async request<T>(
    path: string,
    params: URLSearchParams,
  ): Promise<RawFetch<T>> {
    if (!this.apiKey) {
      return { kind: 'unavailable', reason: 'ZERION_API_KEY not configured' };
    }
    if (!(await this.checkAndIncrementBudget())) {
      return { kind: 'unavailable', reason: 'daily budget exhausted' };
    }

    const url = `${this.baseUrl}${path}?${params.toString()}`;
    const started = Date.now();
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
          Accept: 'application/json',
        },
      });

      // 202 = accepted, still indexing. `response.ok` would swallow this.
      if (response.status === 202) {
        this.logger.log(`[zerion] 202 indexing (${path}) in ${Date.now() - started}ms`);
        return { kind: 'indexing' };
      }

      if (!response.ok) {
        return {
          kind: 'unavailable',
          reason: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      const body = (await response.json()) as T;
      this.logger.log(`[zerion] ok (${path}) in ${Date.now() - started}ms`);
      return { kind: 'ok', body };
    } catch (error: unknown) {
      return { kind: 'unavailable', reason: describeFetchError(error) };
    }
  }

  /**
   * The cache contract, shared by every portfolio fetcher:
   *
   *   default          -> serve the cached entry if present, whatever its age
   *   `refresh: true`  -> bypass it, hit Zerion, overwrite it
   *
   * Cache reads happen BEFORE the budget counter, so a cache hit costs nothing
   * against the daily quota. That is what makes mounting, remounting and tab
   * switching free, and keeps a 1k/day allowance survivable.
   */
  private async cached<T>(opts: {
    key: string;
    ttlSeconds: number;
    wallet: string;
    refresh: boolean;
    empty: T;
    fetch: () => Promise<RawFetch<T>>;
  }): Promise<ZerionResult<T>> {
    const { key, ttlSeconds, wallet, refresh, empty } = opts;

    let throttled = false;
    let wantsFresh = refresh;
    if (refresh && !(await this.allowRefresh(wallet))) {
      wantsFresh = false;
      throttled = true;
    }

    if (!wantsFresh) {
      const hit = await this.readCache<T>(key);
      if (hit) return { ...hit, fromCache: true, ...(throttled ? { throttled } : {}) };
    }

    const raw = await opts.fetch();

    if (raw.kind === 'indexing') {
      // Never cached: an "indexing" answer is a promise of data, not data.
      return { status: 'indexing', data: empty, fetchedAt: nowIso(), fromCache: false };
    }

    if (raw.kind === 'unavailable') {
      this.logger.warn(`[zerion] ${key} unavailable: ${raw.reason}`);
      // Fail open, and prefer a stale entry over nothing.
      const stale = await this.readCache<T>(key);
      if (stale) return { ...stale, fromCache: true };
      return { status: 'ready', data: empty, fetchedAt: nowIso(), fromCache: false };
    }

    const entry: CacheEntry<T> = { data: raw.body, fetchedAt: nowIso() };
    try {
      await this.valkeyService.set(key, entry, { ttl: ttlSeconds });
    } catch (err) {
      this.logger.warn(`[zerion] cache write failed for ${key}: ${describeFetchError(err)}`);
    }
    return {
      status: 'ready',
      data: raw.body,
      fetchedAt: entry.fetchedAt,
      fromCache: false,
      ...(throttled ? { throttled } : {}),
    };
  }

  /**
   * `ValkeyService.get` JSON-parses on the way out, so a cache entry is read
   * back as an object. The wrapper shape matters: storing a bare payload that
   * happens to be `null` would read back as a real `null` and be
   * indistinguishable from a miss.
   */
  private async readCache<T>(key: string): Promise<ZerionResult<T> | null> {
    try {
      const raw = await this.valkeyService.get<CacheEntry<T>>(key);
      if (!raw || typeof raw !== 'object' || !('data' in raw)) return null;
      return {
        status: 'ready',
        data: raw.data,
        fetchedAt: raw.fetchedAt,
        fromCache: true,
      };
    } catch (err) {
      this.logger.warn(`[zerion] cache read failed for ${key}: ${describeFetchError(err)}`);
      return null;
    }
  }

  private cacheKey(
    kind: string,
    wallet: string,
    chainIds: readonly string[],
    suffix?: string,
  ): string {
    const chains = [...chainIds].sort().join(',') || 'all';
    const tail = suffix ? `:${suffix}` : '';
    return `zerion:${kind}:${wallet.toLowerCase()}:${chains}${tail}`;
  }

  /** Shared param set: currency + the chain filter + trash exclusion. */
  private baseParams(chainIds: readonly string[]): URLSearchParams {
    const params = new URLSearchParams({ currency: 'usd' });
    if (chainIds.length > 0) params.set('filter[chain_ids]', chainIds.join(','));
    return params;
  }

  private emptyResult<T>(empty: T): ZerionResult<T> {
    return { status: 'ready', data: empty, fetchedAt: nowIso(), fromCache: false };
  }

  private resolveChains(
    query: PortfolioQuery | undefined,
    capability: ZerionCapability,
  ): string[] {
    return resolveZerionChainIds(query?.chains, capability);
  }

  // ─── Asset discovery ──────────────────────────────────────────────────────

  /**
   * Which assets does this wallet touch? IDENTITY ONLY — quantity and value
   * are dropped on purpose so no caller can mistake them for balances, which
   * the client reads on-chain.
   */
  async discoverAssets(
    walletAddress: string,
    query: PortfolioQuery = {},
  ): Promise<ZerionResult<DiscoveredAsset[]>> {
    const chainIds = this.resolveChains(query, 'tokens');
    if (chainIds.length === 0) return this.emptyResult<DiscoveredAsset[]>([]);

    return this.cached<DiscoveredAsset[]>({
      key: this.cacheKey('discovery', walletAddress, chainIds),
      ttlSeconds: TTL_DISCOVERY_SECONDS,
      wallet: walletAddress,
      refresh: query.refresh === true,
      empty: [],
      fetch: async () => {
        const params = this.baseParams(chainIds);
        params.set('filter[positions]', 'only_simple');
        params.set('filter[trash]', 'only_non_trash');
        const raw = await this.request<{ data?: RawPositionRow[] }>(
          `/wallets/${walletAddress}/positions/`,
          params,
        );
        if (raw.kind !== 'ok') return raw;
        const assets = (raw.body.data ?? [])
          .map(normalizeDiscoveredAsset)
          .filter((a): a is DiscoveredAsset => a !== null);
        return { kind: 'ok', body: dedupeAssets(assets) };
      },
    });
  }

  // ─── DeFi positions ───────────────────────────────────────────────────────

  /**
   * Protocol positions. Unlike discovery this DOES carry a value, because
   * there is no cheap generic on-chain read for an arbitrary protocol
   * position — surfaces must label it an estimate.
   *
   * Field notes verified 2026-08-16 against the live endpoint (real key, real
   * wallets):
   *   - `attributes.position_type` is `"wallet" | "deposit" | "staked" |
   *     "reward" | "locked" | "investment"`. `"wallet"` is a plain holding:
   *     Zerion does NOT reliably classify every protocol receipt token (a real
   *     Compound III `cUSDTv3` balance came back as `"wallet"` with
   *     `value: null`), so callers needing full coverage for protocols we have
   *     our own address-book for must still scan on-chain.
   *   - `relationships.dapp.data.id` is a kebab-case protocol slug, a loose
   *     match for our own `protocolSlug` convention.
   *   - `attributes.pool_address` (when present) is the market/vault contract.
   */
  async getDefiPositions(
    walletAddress: string,
    query: PortfolioQuery = {},
  ): Promise<ZerionResult<ZerionDefiPosition[]>> {
    const chainIds = this.resolveChains(query, 'defi');
    if (chainIds.length === 0) return this.emptyResult<ZerionDefiPosition[]>([]);

    return this.cached<ZerionDefiPosition[]>({
      key: this.cacheKey('defi', walletAddress, chainIds),
      ttlSeconds: TTL_DEFI_SECONDS,
      wallet: walletAddress,
      refresh: query.refresh === true,
      empty: [],
      fetch: async () => {
        const params = this.baseParams(chainIds);
        params.set('filter[positions]', 'only_complex');
        params.set('filter[trash]', 'only_non_trash');
        const raw = await this.request<{ data?: RawPositionRow[] }>(
          `/wallets/${walletAddress}/positions/`,
          params,
        );
        if (raw.kind !== 'ok') return raw;
        const positions = (raw.body.data ?? [])
          .map(normalizeDefiPosition)
          .filter((p): p is ZerionDefiPosition => p !== null);
        return { kind: 'ok', body: positions };
      },
    });
  }

  // ─── NFTs ─────────────────────────────────────────────────────────────────

  /**
   * NFTs are the one place Zerion serves the displayed data rather than just
   * identity: plain RPC cannot enumerate what a wallet owns, and media and
   * floor price only exist at the indexer.
   */
  async getNftPositions(
    walletAddress: string,
    query: NftQuery = {},
  ): Promise<ZerionResult<NftPage>> {
    const empty: NftPage = { items: [], nextCursor: null };
    const chainIds = this.resolveChains(query, 'nft');
    if (chainIds.length === 0) return this.emptyResult<NftPage>(empty);

    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 500);
    const cursorTag = query.pageAfter ? `after:${query.pageAfter}` : `size:${pageSize}`;

    const result = await this.cached<NftPage>({
      key: this.cacheKey('nft', walletAddress, chainIds, cursorTag),
      ttlSeconds: TTL_NFT_SECONDS,
      wallet: walletAddress,
      refresh: query.refresh === true,
      empty,
      fetch: async () => {
        const params = this.baseParams(chainIds);
        params.set('page[size]', String(pageSize));
        if (query.pageAfter) params.set('page[after]', query.pageAfter);
        const raw = await this.request<RawNftResponse>(
          `/wallets/${walletAddress}/nft-positions/`,
          params,
        );
        if (raw.kind !== 'ok') return raw;
        const items = (raw.body.data ?? [])
          .map(normalizeNftPosition)
          .filter((n): n is ZerionNftPosition => n !== null);
        // The cursor is cached alongside the rows: a cache hit has to be able
        // to answer "is there a next page?" without a second upstream call.
        return {
          kind: 'ok',
          body: { items, nextCursor: ZerionClient.nextCursorFromLinks(raw.body.links) },
        };
      },
    });

    return { ...result, nextCursor: result.data.nextCursor };
  }

  /**
   * Next-page cursor for `getNftPositions`. The docs say to page off
   * `links.next` rather than constructing `page[after]` by hand, so this
   * extracts that param from the returned link.
   */
  static nextCursorFromLinks(links?: { next?: string }): string | null {
    if (!links?.next) return null;
    const marker = 'page%5Bafter%5D=';
    const raw = links.next.includes(marker)
      ? links.next.split(marker)[1]
      : links.next.split('page[after]=')[1];
    if (!raw) return null;
    return decodeURIComponent(raw.split('&')[0]);
  }

  // ─── Back-compat surface ──────────────────────────────────────────────────

  /**
   * Principal positions only (`deposit`/`staked`), the shape
   * `StrategiesService` reconciles against. Kept as a thin filter over
   * `getDefiPositions` so widening the normalizer cannot change what
   * reconciliation adopts.
   *
   * Never throws — a failed or unconfigured request degrades to `[]`.
   */
  async getPositions(walletAddress: string): Promise<ZerionDefiPosition[]> {
    const result = await this.getDefiPositions(walletAddress);
    return result.data.filter(
      (p) => p.status === 'deposit' || p.status === 'staked',
    );
  }

  async getPortfolio(walletAddress: string): Promise<unknown> {
    const raw = await this.request<unknown>(
      `/wallets/${walletAddress}/portfolio`,
      new URLSearchParams({ currency: 'usd' }),
    );
    if (raw.kind === 'ok') return raw.body;
    this.logger.warn(
      `[getPortfolio] degraded (${raw.kind === 'unavailable' ? raw.reason : 'indexing'})`,
    );
    return { positions: [], totalValue: 0 };
  }
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: string;
}

/** One page of NFTs plus its continuation cursor, cached as a unit. */
export interface NftPage {
  items: ZerionNftPosition[];
  nextCursor: string | null;
}

// ─── Raw wire shapes ────────────────────────────────────────────────────────

interface RawFungibleInfo {
  name?: string;
  symbol?: string;
  icon?: { url?: string | null } | null;
  flags?: { verified?: boolean } | null;
  implementations?: {
    chain_id?: string;
    address?: string | null;
    decimals?: number;
  }[];
}

interface RawPositionRow {
  attributes?: {
    protocol?: string | null;
    position_type?: string;
    pool_address?: string | null;
    quantity?: { int?: string; decimals?: number; float?: number };
    value?: number | null;
    fungible_info?: RawFungibleInfo;
  };
  relationships?: {
    chain?: { data?: { id?: string } };
    dapp?: { data?: { id?: string } };
  };
}

interface RawNftResponse {
  data?: RawNftRow[];
  links?: { next?: string };
}

interface RawNftRow {
  attributes?: {
    amount?: string | number;
    price?: number | null;
    value?: number | null;
    nft_info?: {
      contract_address?: string;
      token_id?: string;
      name?: string | null;
      content?: {
        preview?: { url?: string | null } | null;
        detail?: { url?: string | null } | null;
      } | null;
    };
    collection_info?: {
      name?: string | null;
      description?: string | null;
      content?: { icon?: { url?: string | null } | null } | null;
    } | null;
  };
  relationships?: { chain?: { data?: { id?: string } } };
}

// ─── Normalizers ────────────────────────────────────────────────────────────

/** Nullable in Zerion's schema — never coerce a missing icon to a string. */
function iconUrl(info: RawFungibleInfo | undefined): string | null {
  const url = info?.icon?.url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

function normalizeDiscoveredAsset(row: RawPositionRow): DiscoveredAsset | null {
  const a = row.attributes;
  const zerionChainId = row.relationships?.chain?.data?.id;
  if (!a || !zerionChainId) return null;

  const chain = chainFromZerionId(zerionChainId);
  if (!chain) return null;

  const info = a.fungible_info;
  const symbol = info?.symbol;
  if (!symbol) return null;

  const impl = info?.implementations?.find((i) => i.chain_id === zerionChainId);
  // A native coin has no contract; Zerion reports `address: null` for it.
  const address = impl?.address ?? null;
  const decimals = impl?.decimals ?? a.quantity?.decimals;
  if (typeof decimals !== 'number') return null;

  return {
    namespace: chain.namespace,
    chainId: chain.chainId,
    // EVM addresses fold case, Solana mints do not — only lower EVM.
    address:
      address === null
        ? null
        : chain.namespace === 'eip155'
          ? address.toLowerCase()
          : address,
    symbol,
    name: info?.name ?? symbol,
    decimals,
    logoUrl: iconUrl(info),
    verified: info?.flags?.verified === true,
  };
}

/** Same asset can appear once per position row; identity is chain + address. */
function dedupeAssets(assets: DiscoveredAsset[]): DiscoveredAsset[] {
  const seen = new Set<string>();
  const out: DiscoveredAsset[] = [];
  for (const a of assets) {
    const key = `${a.namespace}:${a.chainId ?? 'na'}:${a.address ?? 'native'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function isPositionStatus(value: string | undefined): value is ZerionPositionStatus {
  return (
    typeof value === 'string' &&
    (ZERION_POSITION_STATUSES as readonly string[]).includes(value)
  );
}

function normalizeDefiPosition(row: RawPositionRow): ZerionDefiPosition | null {
  const a = row.attributes;
  const zerionChainId = row.relationships?.chain?.data?.id;
  if (!a || !zerionChainId) return null;

  // `"wallet"` and `"investment"` are not protocol positions — drop them.
  if (!isPositionStatus(a.position_type)) return null;

  const info = a.fungible_info;
  const symbol = info?.symbol;
  const quantityRaw = a.quantity?.int;
  const decimals = a.quantity?.decimals;
  if (!symbol || quantityRaw === undefined || typeof decimals !== 'number') {
    return null;
  }

  const chain = chainFromZerionId(zerionChainId);
  const impl = info?.implementations?.find((i) => i.chain_id === zerionChainId);

  return {
    dappId: row.relationships?.dapp?.data?.id ?? null,
    protocolName: a.protocol ?? null,
    poolAddress: a.pool_address ?? null,
    zerionChainId,
    chainId: chain?.chainId ?? null,
    assetSymbol: symbol,
    assetContract: impl?.address?.toLowerCase() ?? null,
    quantityRaw,
    decimals,
    valueUsd: a.value ?? null,
    logoUrl: iconUrl(info),
    status: a.position_type,
  };
}

function normalizeNftPosition(row: RawNftRow): ZerionNftPosition | null {
  const a = row.attributes;
  const nft = a?.nft_info;
  const zerionChainId = row.relationships?.chain?.data?.id;
  if (!a || !nft?.contract_address || !nft.token_id || !zerionChainId) return null;

  const chain = chainFromZerionId(zerionChainId);
  if (!chain) return null;

  const amount = Number(a.amount ?? 1);

  return {
    chainId: chain.chainId,
    namespace: chain.namespace,
    contractAddress:
      chain.namespace === 'eip155'
        ? nft.contract_address.toLowerCase()
        : nft.contract_address,
    tokenId: nft.token_id,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
    name: nft.name ?? null,
    description: a.collection_info?.description ?? null,
    previewUrl: nft.content?.preview?.url ?? null,
    detailUrl: nft.content?.detail?.url ?? null,
    collectionName: a.collection_info?.name ?? null,
    collectionIconUrl: a.collection_info?.content?.icon?.url ?? null,
    floorPrice: a.price ?? null,
    valueUsd: a.value ?? null,
  };
}

/** Back-compat alias: `StrategiesService` imports this name. */
export type ZerionPosition = ZerionDefiPosition;
