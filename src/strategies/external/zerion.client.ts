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
}
