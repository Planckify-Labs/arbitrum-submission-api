import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  TVCGamerAPIConfig,
  TVCgamerResponse,
  TVCGamerProduct,
  TVCGamerProductVariant,
  TVCGamerOrderResponse,
} from "../types/vcgamer-api.types";
import { TVendorRequestError } from "../types/error.types";
import { PrismaService } from "../../../prisma/prisma.service";
import { VendorAPICacheService } from "../../../valkey/services/vendor-api-cache.service";

// ── Fulfilment port ───────────────────────────────────────────────────
// The only vendor knowledge the fulfilment leg (src/fulfilment) has. Each
// adapter maps its own status codes / response bodies onto these; nothing
// vendor-specific (codes, field names, env vars) may leak past this file.

export type VendorOrderOutcome = "delivered" | "failed" | "pending";

export interface VendorOrderStatus {
  outcome: VendorOrderOutcome;
  /** What the vendor handed over, verbatim (voucher code, token, serial), or null. */
  raw: string | null;
  /** Vendor's own words for a `failed` outcome, for ops. */
  reason?: string;
  /** The vendor body, cached on the order for audit. Shape is the adapter's business. */
  response: unknown;
  /** The lookup itself failed (transport, auth): nothing was learned — treat as pending. */
  unavailable?: boolean;
}

/**
 * Whether money can go back automatically after `createOrder` did not
 * yield an accepted order. `definitive`: the vendor understood the
 * request and said no (bad target id, sold out). `ambiguous`: a timeout,
 * 5xx, rate limit, our own auth problem or a lost response — an order
 * may exist on the vendor side, so a human decides.
 */
export interface VendorOrderFailure {
  cls: "definitive" | "ambiguous";
  reason: string;
}

@Injectable()
export abstract class BaseVendorService {
  /** Matches `Vendor.name` — how `VendorRegistry` finds this adapter. */
  abstract readonly vendorName: string;

  protected readonly logger = new Logger(this.constructor.name);
  protected config: TVCGamerAPIConfig;

  constructor(
    protected readonly configService: ConfigService,
    protected readonly prisma: PrismaService,
    protected readonly vendorAPICacheService: VendorAPICacheService,
    vendorName: string,
  ) {
    this.initializeConfig(vendorName);
  }

  private async initializeConfig(vendorName: string): Promise<void> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { name: vendorName },
    });

    if (!vendor) {
      throw new Error(`Vendor ${vendorName} not found`);
    }

    const vendorAPI = await this.vendorAPICacheService.getVendorAPI(vendor.id);

    if (!vendorAPI) {
      throw new Error(`Vendor API configuration not found for ${vendorName}`);
    }

    this.config = {
      baseUrl: vendorAPI.baseUrl,
      apiKey: vendorAPI.apiKey,
      apiSecret: vendorAPI.apiSecret || undefined,
      vendorId: vendor.id,
    };

    this.logger.log(`Initialized ${vendorName} configuration from cache`);
  }

  protected generateUniqueRefId(): string {
    const timestamp = Date.now().toString().slice(-6);
    const randomDigits = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    return `TRX${timestamp}${randomDigits}`;
  }

  protected abstract createSignature(params: string): string;

  protected async makeRequest<T>(
    method: string,
    endpoint: string,
    data?: unknown,
    retries = 3,
  ): Promise<TVCgamerResponse<T>> {
    const maxRetries = retries;
    let lastError: TVendorRequestError = new Error(
      "Unknown error",
    ) as TVendorRequestError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = `${this.config.baseUrl}${endpoint}`;
        const headers = {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        };

        this.logger.debug(
          `Making vendor API request (attempt ${attempt + 1}/${maxRetries + 1}):`,
          {
            url,
            method,
            hasData: !!data,
          },
        );

        const response = await fetch(url, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          signal: AbortSignal.timeout(30000),
        });

        const responseData = await response.json();

        this.logger.debug("Vendor API response received:", {
          status: response.status,
          ok: response.ok,
          hasData: !!responseData,
        });

        if (!response.ok) {
          const errorMessage =
            responseData.message || `HTTP error! status: ${response.status}`;
          const error = new Error(errorMessage) as TVendorRequestError;
          error.status = response.status;
          error.responseData = responseData;
          throw error;
        }

        return {
          success: true,
          statusCode: response.status,
          message: "Success",
          data: responseData,
        };
      } catch (error) {
        lastError = error as TVendorRequestError;

        const isRetryable = this.isRetryableError(lastError);
        const attemptsLeft = maxRetries - attempt;

        if (isRetryable && attemptsLeft > 0) {
          const delay = this.calculateRetryDelay(attempt);
          this.logger.warn(
            `Vendor API request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
            {
              error: lastError.message,
              status: lastError.status,
              attemptsLeft,
            },
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        this.logger.error(
          `Vendor API request failed after ${attempt + 1} attempts:`,
          {
            error: lastError.message,
            status: lastError.status,
            endpoint,
            method,
          },
        );
        break;
      }
    }

    return this.mapErrorToResponse(lastError);
  }

  private isRetryableError(error: TVendorRequestError): boolean {
    if (!error.status) {
      return true;
    }

    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];

    return retryableStatusCodes.includes(error.status);
  }

  private calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000;
    const maxDelay = 10000;
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }

  private mapErrorToResponse<T>(
    error: TVendorRequestError,
  ): TVCgamerResponse<T> {
    const status = error.status || 500;
    let mappedStatus = status;
    let errorMessage = error.message || "Unknown error occurred";

    switch (status) {
      case 401:
      case 403:
        mappedStatus = 401;
        errorMessage = "Vendor authentication failed";
        break;
      case 404:
        mappedStatus = 404;
        errorMessage = "Vendor resource not found";
        break;
      case 429:
        mappedStatus = 429;
        errorMessage = "Vendor rate limit exceeded";
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        mappedStatus = 503;
        errorMessage = "Vendor service temporarily unavailable";
        break;
      default:
        if (status >= 400 && status < 500) {
          mappedStatus = 502;
          errorMessage = "Invalid vendor response";
        } else if (!status) {
          mappedStatus = 503;
          errorMessage = "Unable to connect to vendor service";
        }
    }

    return {
      success: false,
      statusCode: mappedStatus,
      message: errorMessage,
      error: errorMessage,
      originalError: {
        status: status,
        message: error.message,
        responseData: error.responseData,
      },
    };
  }

  abstract getProducts(): Promise<TVCgamerResponse<TVCGamerProduct[]>>;
  abstract getProductVariants(
    productId: string,
  ): Promise<TVCgamerResponse<TVCGamerProductVariant[]>>;

  abstract createOrder(
    brandKey: string,
    variationKey: string,
    price: number,
    data: Array<{ key: string; value: string }>,
    customRefId?: string,
  ): Promise<TVCgamerResponse<TVCGamerOrderResponse>>;

  /** Ask the vendor how an accepted order is doing, normalised. */
  abstract checkOrder(vendorRefId: string): Promise<VendorOrderStatus>;

  /** Classify a `createOrder` result that did not produce an accepted order. */
  abstract classifyOrderFailure(
    resp: TVCgamerResponse<TVCGamerOrderResponse>,
  ): VendorOrderFailure;
}
