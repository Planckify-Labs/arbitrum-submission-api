import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createConfig,
  getQuote,
  getStatus,
  type LiFiStep,
  type StatusResponse,
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
 * Slim quote shape the mobile executor consumes. The full
 * `LiFiStep` carries far more (tool, action, estimate, includedSteps)
 * than the mobile bridge submission needs.
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
  };
  tool: string;
  toolName?: string;
}

function stringifyBigIntish(
  v: string | number | bigint | undefined,
): string | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : String(v);
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
      },
      tool: step.tool,
      toolName: step.toolDetails?.name,
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
