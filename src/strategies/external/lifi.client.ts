import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createConfig,
  getQuote,
  getStatus,
  type LiFiStep,
  type StatusResponse,
  type Token,
} from "@lifi/sdk";
import { DefiError } from "../errors/defi-error";

const DEFAULT_INTEGRATOR = "takumipay";

/**
 * Mobile-facing transaction request. Mirrors the LI.FI SDK's
 * `TransactionRequest` but with `BigIntish` fields coerced to string
 * so the JSON payload is stable across runtimes (mobile reads these
 * back into `bigint`).
 */
export interface LifiTransactionRequest {
  to: string;
  data: string;
  value: string;
  from?: string;
  chainId?: number;
  gasPrice?: string;
  gasLimit?: string;
}

/**
 * Token metadata carried alongside every amount.
 *
 * `decimals` exists because we used to return `toAmount` WITHOUT it, so
 * every call site formatted by guesswork (spec §6). That is not
 * theoretical: Stellar USDC is 7 decimals while USDC everywhere else is
 * 6, so a shared `USDC_DECIMALS = 6` constant would misprice every
 * Stellar amount by 10x.
 */
export interface LifiQuoteToken {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
  priceUSD?: string;
  logoURI?: string;
  chainId: number;
}

/** One itemised fee line. See `included` — it is the load-bearing field. */
export interface LifiQuoteFee {
  name: string;
  description?: string;
  amount: string;
  amountUSD?: string;
  token: LifiQuoteToken;
  /**
   * Whether the fee is ALREADY deducted from the output or charged on
   * top. Ignoring it means we either double-count or under-report fees
   * (spec §6).
   */
  included: boolean;
}

export interface LifiQuoteGasCost {
  type: string;
  amount: string;
  amountUSD?: string;
  token: LifiQuoteToken;
}

export interface LifiQuoteStep {
  tool: string;
  toolName?: string;
  toolLogoURI?: string;
  fromToken: LifiQuoteToken;
  toToken: LifiQuoteToken;
  fromAmount: string;
  toAmount: string;
}

/**
 * Quote shape the mobile executor consumes.
 *
 * Spec §6 (phase 0). This used to keep 8 fields and discard everything a
 * bridge confirmation must show. Widening is PURELY ADDITIVE — every
 * previously-present field keeps its name, position, and meaning — so the
 * shipped `defi_cross_chain_deposit` path is unaffected while gaining the
 * disclosure numbers §7 requires.
 *
 * The two urgent additions:
 *   - `toAmountMin` is the worst-case guarantee. Without it there is no
 *     protection number on screen at all.
 *   - `feeCosts[].included` (above) decides whether fees add or subtract.
 */
export interface LifiQuote {
  transactionRequest: LifiTransactionRequest;
  estimate: {
    toAmount: string;
    executionDuration: number;
    fromAmount?: string;
    fromAmountUSD?: string;
    toAmountUSD?: string;
    approvalAddress?: string;
    /** Worst-case output the user is guaranteed. */
    toAmountMin?: string;
    feeCosts?: LifiQuoteFee[];
    gasCosts?: LifiQuoteGasCost[];
  };
  tool: string;
  toolName?: string;
  /** Bridge logo, for the "who am I trusting" disclosure (§7.3). */
  toolLogoURI?: string;
  /** Slippage tolerance actually applied, as a visible number (§7.2). */
  slippage?: number;
  fromToken?: LifiQuoteToken;
  toToken?: LifiQuoteToken;
  /** Destination address the route will credit (§7.4). */
  toAddress?: string;
  /** Route breakdown when the transfer is multi-step (§7.3). */
  includedSteps?: LifiQuoteStep[];
}

function stringifyBigIntish(
  v: string | number | bigint | undefined,
): string | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : String(v);
}

/**
 * Map a LI.FI `Token` onto the wire shape, carrying `decimals` through.
 * Sourcing decimals per token (rather than assuming) is the whole point
 * of the §6 widening.
 */
function toQuoteToken(token: Token): LifiQuoteToken {
  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    priceUSD: token.priceUSD,
    logoURI: token.logoURI,
    chainId: token.chainId,
  };
}

@Injectable()
export class LifiClient {
  private readonly logger = new Logger(LifiClient.name);
  private readonly integrator: string;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.integrator =
      this.configService.get<string>("LIFI_INTEGRATOR") || DEFAULT_INTEGRATOR;
    this.apiKey = this.configService.get<string>("LIFI_API_KEY") || "";

    // `createConfig` is global to the SDK; calling it once per process
    // is correct. The Nest singleton lifecycle guarantees that.
    //
    // `preloadChains: false` is deliberate: the SDK otherwise fires an
    // eager, detached `getChains()` at config time. When li.quest 404s
    // (public endpoint / transient), that background promise rejects with
    // nothing awaiting it and Node's unhandled-rejection handler takes the
    // whole API process down. Quotes (`getQuote`) still resolve chains
    // lazily, and those calls are already wrapped in try/catch — so a LI.FI
    // outage degrades cross-chain quotes instead of crashing the server.
    createConfig({
      integrator: this.integrator,
      preloadChains: false,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
    });

    if (!this.apiKey) {
      this.logger.log(
        "LIFI_API_KEY not set — using LI.FI public endpoint (rate-limited).",
      );
    }
  }

  async getRoute(
    fromChain: number,
    toChain: number,
    fromToken: string,
    toToken: string,
    amount: string,
    fromAddress: string,
    toAddress?: string,
  ): Promise<LifiQuote> {
    const started = Date.now();
    this.logger.log(
      `[getRoute] -> LI.FI ${amount} ${fromToken}@${fromChain} -> ${toToken}@${toChain} from=${fromAddress}`,
    );

    let step: LiFiStep;
    try {
      step = await getQuote({
        fromChain,
        toChain,
        fromToken,
        toToken,
        fromAmount: amount,
        fromAddress,
        ...(toAddress ? { toAddress } : {}),
      });
    } catch (error: unknown) {
      // SDK throws LiFiError with curated codes; we never echo its
      // message into the response body — log it, return our own code.
      const detail =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[getRoute] LI.FI SDK error: ${detail}`);
      throw new DefiError("network_error", detail);
    }

    const txReq = step.transactionRequest;
    if (!txReq || !txReq.to || !txReq.data) {
      this.logger.error(
        "[getRoute] LI.FI returned a step without an executable transactionRequest",
      );
      throw new DefiError(
        "network_error",
        "LI.FI step missing transactionRequest",
      );
    }

    const estimate = step.estimate ?? ({} as LiFiStep["estimate"]);
    const quote: LifiQuote = {
      transactionRequest: {
        to: txReq.to,
        data: txReq.data,
        value: stringifyBigIntish(txReq.value) ?? "0",
        from: txReq.from,
        chainId: txReq.chainId,
        gasPrice: stringifyBigIntish(txReq.gasPrice),
        gasLimit: stringifyBigIntish(txReq.gasLimit),
      },
      estimate: {
        toAmount: estimate.toAmount ?? "0",
        executionDuration: Number(estimate.executionDuration ?? 0),
        fromAmount: estimate.fromAmount,
        fromAmountUSD: estimate.fromAmountUSD,
        toAmountUSD: estimate.toAmountUSD,
        approvalAddress: estimate.approvalAddress,
        toAmountMin: estimate.toAmountMin,
        feeCosts: (estimate.feeCosts ?? []).map((fee) => ({
          name: fee.name,
          description: fee.description,
          amount: fee.amount,
          amountUSD: fee.amountUSD,
          token: toQuoteToken(fee.token),
          // Never defaulted to `true` — an unknown `included` that we
          // guessed as "already deducted" would silently under-report the
          // real cost (§6).
          included: fee.included === true,
        })),
        gasCosts: (estimate.gasCosts ?? []).map((gas) => ({
          type: gas.type,
          amount: gas.amount,
          amountUSD: gas.amountUSD,
          token: toQuoteToken(gas.token),
        })),
      },
      tool: step.tool,
      toolName: step.toolDetails?.name,
      toolLogoURI: step.toolDetails?.logoURI,
      slippage: step.action?.slippage,
      fromToken: step.action?.fromToken
        ? toQuoteToken(step.action.fromToken)
        : undefined,
      toToken: step.action?.toToken ? toQuoteToken(step.action.toToken) : undefined,
      toAddress: step.action?.toAddress,
      includedSteps: (step.includedSteps ?? []).map((inc) => ({
        tool: inc.tool,
        toolName: inc.toolDetails?.name,
        toolLogoURI: inc.toolDetails?.logoURI,
        fromToken: toQuoteToken(inc.action.fromToken),
        toToken: toQuoteToken(inc.action.toToken),
        fromAmount: inc.action.fromAmount,
        toAmount: inc.estimate?.toAmount ?? "0",
      })),
    };

    this.logger.log(
      `[getRoute] <- LI.FI returned route in ${Date.now() - started}ms (tool=${step.tool}, toAmount=${quote.estimate.toAmount})`,
    );
    return quote;
  }

  /**
   * Poll LI.FI for a previously-submitted bridge tx. Returns the
   * top-level status string ("NOT_FOUND" | "INVALID" | "PENDING" |
   * "DONE" | "FAILED") plus the more granular substatus.
   */
  async getStatus(
    fromChain: number,
    toChain: number,
    txHash: string,
  ): Promise<{ status: string; substatus?: string }> {
    let res: StatusResponse;
    try {
      res = await getStatus({
        fromChain,
        toChain,
        txHash,
      });
    } catch (error: unknown) {
      const detail =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[getStatus] LI.FI SDK error: ${detail}`);
      throw new DefiError("network_error", detail);
    }
    return {
      status: res.status ?? "UNKNOWN",
      substatus: res.substatus,
    };
  }
}
