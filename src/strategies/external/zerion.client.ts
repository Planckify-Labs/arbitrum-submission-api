import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValkeyService } from '../../valkey/valkey.service';

const DEFAULT_DAILY_BUDGET_REQUESTS = 1000;

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

  private getRateLimitKey(): string {
    const today = new Date().toISOString().split('T')[0];
    return `zerion:ratelimit:${today}`;
  }

  private async checkAndIncrementBudget(): Promise<boolean> {
    const key = this.getRateLimitKey();
    const countStr = await this.valkeyService.get<string>(key);
    let count = countStr ? parseInt(countStr, 10) : 0;

    if (count >= this.dailyBudget) {
      this.logger.warn(`Zerion daily budget of ${this.dailyBudget} requests exceeded.`);
      return false;
    }

    count++;
    await this.valkeyService.set(key, count.toString(), { ttl: 86400 });
    return true;
  }

  async getPortfolio(walletAddress: string): Promise<unknown> {
    const started = Date.now();
    this.logger.log(
      `[getPortfolio] -> Zerion wallet=${walletAddress} (hasKey=${Boolean(this.apiKey)})`,
    );
    if (!this.apiKey) {
      this.logger.warn(
        '[getPortfolio] ZERION_API_KEY not configured — returning mocked portfolio',
      );
      return this.getMockPortfolio();
    }

    const hasBudget = await this.checkAndIncrementBudget();
    if (!hasBudget) {
      this.logger.warn(
        '[getPortfolio] Zerion daily budget exhausted — returning mocked portfolio',
      );
      return this.getMockPortfolio();
    }

    try {
      const authHeader = `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`;
      const response = await fetch(
        `${this.baseUrl}/wallets/${walletAddress}/portfolio`,
        {
          headers: {
            Authorization: authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Zerion API error: ${response.statusText}`);
      }

      const body = await response.json();
      this.logger.log(
        `[getPortfolio] <- Zerion ok in ${Date.now() - started}ms`,
      );
      return body;
    } catch (error: unknown) {
      this.logger.error(
        `[getPortfolio] Zerion request failed (url=${this.baseUrl}/wallets/${walletAddress}/portfolio): ${describeFetchError(error)}`,
      );
      return this.getMockPortfolio();
    }
  }

  private getMockPortfolio() {
    return {
      positions: [],
      totalValue: 0,
    };
  }

  /**
   * DeFi position discovery — verified 2026-08-16 against the live
   * `GET /v1/wallets/{addr}/positions/` endpoint (real key, real wallets).
   * Ground truth from that run:
   *   - `attributes.position_type` is `"wallet"` | `"deposit"` | `"staked"` |
   *     `"reward"` | `"locked"` | `"investment"`. Only `"deposit"`/`"staked"`
   *     are principal positions in a protocol; `"wallet"` is a plain token
   *     holding (Zerion does NOT reliably classify every protocol receipt
   *     token as a position — e.g. a Compound III `cUSDTv3` balance came
   *     back as plain `"wallet"` type with `value: null`, not `"deposit"`).
   *     Callers needing full coverage for protocols we have our own
   *     address-book for (Comet, …) must supplement this with a direct
   *     on-chain scan — see `StrategiesService`'s reconciliation.
   *   - `relationships.dapp.data.id` is a kebab-case protocol slug
   *     ("aave-v2", "yearn-v3", "uniswap-v3", "balancer", …) — a loose,
   *     not exact, match for our own `protocolSlug` convention.
   *   - `attributes.pool_address` (when present) is the on-chain
   *     market/vault/pool contract.
   *   - `attributes.fungible_info.implementations[]` carries the
   *     underlying asset's contract per chain (`null` for a native coin).
   * Never throws — a failed/unconfigured request degrades to `[]`, same
   * fail-open posture as `getPortfolio`.
   */
  async getPositions(walletAddress: string): Promise<ZerionPosition[]> {
    const started = Date.now();
    if (!this.apiKey) {
      this.logger.warn(
        "[getPositions] ZERION_API_KEY not configured — returning no discovered positions",
      );
      return [];
    }

    const hasBudget = await this.checkAndIncrementBudget();
    if (!hasBudget) {
      this.logger.warn(
        "[getPositions] Zerion daily budget exhausted — skipping discovery this call",
      );
      return [];
    }

    try {
      const authHeader = `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`;
      const params = new URLSearchParams({
        currency: "usd",
        "filter[positions]": "no_filter",
        "filter[trash]": "only_non_trash",
      });
      const response = await fetch(
        `${this.baseUrl}/wallets/${walletAddress}/positions/?${params.toString()}`,
        {
          headers: { Authorization: authHeader, Accept: "application/json" },
        },
      );
      if (!response.ok) {
        throw new Error(`Zerion API error: ${response.statusText}`);
      }
      const body = (await response.json()) as { data?: ZerionPositionRow[] };
      const positions = (body.data ?? [])
        .map(normalizeZerionPosition)
        .filter((p): p is ZerionPosition => p !== null);
      this.logger.log(
        `[getPositions] <- Zerion ok in ${Date.now() - started}ms (${positions.length} DeFi positions)`,
      );
      return positions;
    } catch (error: unknown) {
      this.logger.error(
        `[getPositions] Zerion request failed (wallet=${walletAddress}): ${describeFetchError(error)}`,
      );
      return [];
    }
  }
}

/** Raw shape of one `data[]` row from `GET /wallets/{addr}/positions/`. */
interface ZerionPositionRow {
  attributes: {
    protocol: string | null;
    position_type: string;
    pool_address?: string | null;
    quantity: { int: string; decimals: number; float: number };
    value: number | null;
    fungible_info: {
      symbol: string;
      implementations: { chain_id: string; address: string | null }[];
    };
  };
  relationships?: {
    chain?: { data?: { id?: string } };
    dapp?: { data?: { id?: string } };
  };
}

/** Normalized DeFi position — what `StrategiesService` reconciles against. */
export interface ZerionPosition {
  dappId: string | null;
  protocolName: string | null;
  poolAddress: string | null;
  zerionChainId: string;
  assetSymbol: string;
  assetContract: string | null;
  quantityRaw: string;
  decimals: number;
  valueUsd: number | null;
}

function normalizeZerionPosition(row: ZerionPositionRow): ZerionPosition | null {
  const a = row.attributes;
  if (a.position_type !== "deposit" && a.position_type !== "staked") return null;
  const chainId = row.relationships?.chain?.data?.id;
  if (!chainId) return null;
  const implementation = a.fungible_info.implementations.find(
    (impl) => impl.chain_id === chainId,
  );
  return {
    dappId: row.relationships?.dapp?.data?.id ?? null,
    protocolName: a.protocol,
    poolAddress: a.pool_address ?? null,
    zerionChainId: chainId,
    assetSymbol: a.fungible_info.symbol,
    assetContract: implementation?.address?.toLowerCase() ?? null,
    quantityRaw: a.quantity.int,
    decimals: a.quantity.decimals,
    valueUsd: a.value,
  };
}
