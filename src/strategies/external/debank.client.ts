import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValkeyService } from '../../valkey/valkey.service';

const DEFAULT_DAILY_BUDGET_CENTS = 500; // $5/day fallback

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
export class DeBankClient {
  private readonly logger = new Logger(DeBankClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly dailyBudgetCents: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly valkeyService: ValkeyService,
  ) {
    const key = this.configService.get<string>('DEBANK_API_KEY');
    if (!key) {
      throw new Error('DEBANK_API_KEY is required for DeFi Strategies.');
    }
    this.apiKey = key;
    this.baseUrl = requireUrl(this.configService, 'DEBANK_API_URL');
    const budget = Number(
      this.configService.get<string>('DEFI_DEBANK_DAILY_BUDGET_CENTS'),
    );
    this.dailyBudgetCents =
      Number.isFinite(budget) && budget > 0
        ? Math.floor(budget)
        : DEFAULT_DAILY_BUDGET_CENTS;
  }

  private getRateLimitKey(): string {
    const today = new Date().toISOString().split('T')[0];
    return `debank:budget:${today}`;
  }

  private async checkAndIncrementBudget(costCents: number): Promise<boolean> {
    const key = this.getRateLimitKey();
    let currentSpendStr = await this.valkeyService.get<string>(key);
    let currentSpend = currentSpendStr ? parseInt(currentSpendStr, 10) : 0;

    if (currentSpend + costCents > this.dailyBudgetCents) {
      this.logger.warn(`DeBank daily budget of ${this.dailyBudgetCents} cents exceeded.`);
      return false;
    }

    currentSpend += costCents;
    await this.valkeyService.set(key, currentSpend.toString(), { ttl: 86400 });
    return true;
  }

  /**
   * Fetch user history across all chains.
   * API Ref: GET /v1/user/all_history_list
   */
  async getUserHistory(walletAddress: string): Promise<any> {
    const started = Date.now();
    this.logger.log(
      `[getUserHistory] -> DeBank wallet=${walletAddress}`,
    );
    const hasBudget = await this.checkAndIncrementBudget(1);
    if (!hasBudget) {
      this.logger.warn(
        '[getUserHistory] DeBank daily budget exhausted — returning empty list',
      );
      return [];
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/user/all_history_list?id=${walletAddress}`,
        {
          headers: {
            AccessKey: this.apiKey,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`DeBank API error: ${response.statusText}`);
      }

      const data = await response.json();
      const items = data.history_list || [];
      this.logger.log(
        `[getUserHistory] <- DeBank returned ${items.length} items in ${Date.now() - started}ms`,
      );
      return items;
    } catch (error: unknown) {
      this.logger.error(
        `[getUserHistory] DeBank request failed (url=${this.baseUrl}/user/all_history_list?id=${walletAddress}): ${describeFetchError(error)}`,
      );
      return [];
    }
  }

  /**
   * Fetch token approvals (authorizations) for a specific chain.
   * API Ref: GET /v1/user/token_authorized_list
   */
  async getTokenApprovals(walletAddress: string, chainId: string): Promise<any> {
    const started = Date.now();
    this.logger.log(
      `[getTokenApprovals] -> DeBank wallet=${walletAddress} chain=${chainId}`,
    );
    const hasBudget = await this.checkAndIncrementBudget(1);
    if (!hasBudget) {
      this.logger.warn(
        '[getTokenApprovals] DeBank daily budget exhausted — returning empty list',
      );
      return [];
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/user/token_authorized_list?id=${walletAddress}&chain_id=${chainId}`,
        {
          headers: {
            AccessKey: this.apiKey,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`DeBank API error: ${response.statusText}`);
      }

      const body = await response.json();
      this.logger.log(
        `[getTokenApprovals] <- DeBank ok in ${Date.now() - started}ms`,
      );
      return body;
    } catch (error: unknown) {
      this.logger.error(
        `[getTokenApprovals] DeBank request failed (url=${this.baseUrl}/user/token_authorized_list?id=${walletAddress}&chain_id=${chainId}): ${describeFetchError(error)}`,
      );
      return [];
    }
  }
}
