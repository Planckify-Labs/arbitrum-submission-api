/**
 * Tower Exchange Public API — thin HTTP client.
 *
 * Tower (https://docs.tower.exchange) is the DEX aggregator on Arc. Only
 * the two swap endpoints are used: `POST /swap/quote` and
 * `POST /swap/build-tx`. Tower's `POST /bridge` is deliberately NOT used:
 * it executes the transfer server-side and returns a tx hash, with no
 * unsigned payload for the user's wallet to sign, so it cannot be
 * non-custodial.
 *
 * The live API diverges from the published docs in ways that matter
 * (verified 2026-09-23 against `sk_test_` and the OpenAPI spec):
 *
 *  - Network selection is an UNDOCUMENTED `chainId` body field. Without it
 *    every quote routes on Arc mainnet (5042), and a testnet token address
 *    is silently rewritten to its mainnet counterpart. We always send it.
 *  - `inputAmount` / `outputAmount` / `minOut` are normalised to 1e18
 *    (`amountScale: "normalized_1e18"`). The token's own smallest unit is
 *    in the `*Raw` fields, which are the only ones we read.
 *  - `/swap/build-tx` rejects a quote without its `expiresAt`, so the quote
 *    object is passed back untouched.
 *
 * Everything returned here is UNTRUSTED: the adapter re-validates tokens,
 * amounts, chain id and the target contract before a payload reaches a
 * wallet.
 */

import { Logger } from "@nestjs/common";
import { DefiError } from "../../strategies/errors/defi-error";

export const DEFAULT_TOWER_API_URL = "https://www.tower.exchange/api/public";

const REQUEST_TIMEOUT_MS = 15_000;

/** The quote object, as returned. Only the fields we read are typed. */
export interface TowerQuote {
  inputToken: string;
  outputToken: string;
  inputAmountRaw?: string;
  outputAmountRaw?: string;
  minOutRaw?: string;
  platformFeeAmountRaw?: string;
  inputTokenDecimals?: number;
  outputTokenDecimals?: number;
  feeBps?: number;
  /** BASIS POINTS despite the docs saying "percentage". Convert in the adapter. */
  priceImpact?: number;
  dexId?: string;
  dexName?: string;
  route?: { hops?: Array<{ dexId?: string; dexName?: string }> };
  expiresAt?: string;
  routeOptions?: Array<{
    dexId?: string;
    dexName?: string;
    outputAmountRaw?: string;
    minOutRaw?: string;
    priceImpact?: number;
  }>;
  [key: string]: unknown;
}

export interface TowerTxRequest {
  to: string;
  data: string;
  value?: string;
  from?: string;
  gasLimit?: string;
  chainId?: number;
  token?: string;
  spender?: string;
  amountRaw?: string;
}

export interface TowerBuiltTx {
  approval: TowerTxRequest | null;
  swap: TowerTxRequest;
}

export interface TowerQuoteParams {
  chainId: number;
  inputToken: string;
  outputToken: string;
  /** Smallest unit of the input token. */
  inputAmount: string;
  slippageBps: number;
  dexId?: string;
}

/**
 * Tower's "we could not price this pair" answer. Distinct from an outage
 * so the bridge service reports `no_route_found` rather than a transient
 * `check_unavailable`.
 */
export class TowerNoRouteError extends Error {
  readonly name = "TowerNoRouteError";
}

/** `/swap/build-tx` refused a quote. The adapter retries another venue. */
export class TowerBuildError extends Error {
  readonly name = "TowerBuildError";
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export class TowerClient {
  private readonly logger = new Logger(TowerClient.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_TOWER_API_URL,
  ) {}

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async quote(params: TowerQuoteParams): Promise<TowerQuote> {
    const body = await this.post<TowerQuote>("/swap/quote", {
      chainId: params.chainId,
      inputToken: params.inputToken,
      outputToken: params.outputToken,
      inputAmount: params.inputAmount,
      slippageTolerance: params.slippageBps,
      ...(params.dexId ? { dexId: params.dexId } : {}),
    });
    if (body.success !== true || !body.data) {
      this.logger.warn(
        `[quote] declined: ${body.code ?? "no_code"} ${body.error ?? ""}`,
      );
      throw new TowerNoRouteError("tower quote declined");
    }
    return body.data;
  }

  async buildTx(
    quote: TowerQuote,
    userAddress: string,
    chainId: number,
  ): Promise<TowerBuiltTx> {
    const body = await this.post<TowerBuiltTx>("/swap/build-tx", {
      quote,
      userAddress,
      chainId,
    });
    if (body.success !== true || !body.data?.swap) {
      this.logger.warn(
        `[buildTx] declined (${quote.dexId ?? "auto"}): ${body.code ?? "no_code"} ${body.error ?? ""}`,
      );
      throw new TowerBuildError("tower build declined");
    }
    return body.data;
  }

  /**
   * POST with a timeout. Transport failures, 401/403 (our key), 429 and
   * 5xx all become `network_error`, which the bridge service reports as
   * "we could not check routes right now", never as "unsupported".
   *
   * A 5xx whose body is a Tower envelope (`BUILD_TX_FAILED` comes back as
   * a 500) is returned to the caller so it can fall back to another venue.
   */
  private async post<T>(path: string, payload: unknown): Promise<Envelope<T>> {
    if (!this.isConfigured()) {
      throw new DefiError("network_error", "TOWER_API_KEY is not set");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${path}] transport error: ${detail}`);
      throw new DefiError("network_error", `tower ${path} unreachable`);
    } finally {
      clearTimeout(timer);
    }

    let body: Envelope<T> | null = null;
    try {
      body = (await response.json()) as Envelope<T>;
    } catch {
      body = null;
    }

    if (response.status === 401 || response.status === 403) {
      this.logger.error(
        `[${path}] Tower rejected the API key (${response.status}): ${body?.error ?? ""}`,
      );
      throw new DefiError("network_error", `tower ${path} auth failed`);
    }
    if (response.status === 429) {
      this.logger.warn(`[${path}] Tower rate limit hit`);
      throw new DefiError("network_error", `tower ${path} rate limited`);
    }
    if (!body || (response.status >= 500 && body.success === undefined)) {
      this.logger.warn(`[${path}] Tower error ${response.status}`);
      throw new DefiError("network_error", `tower ${path} failed`);
    }
    return body;
  }
}
