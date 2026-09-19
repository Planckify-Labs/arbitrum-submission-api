import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BaseVendorService,
  VendorOrderFailure,
  VendorOrderStatus,
} from "../../base/base-vendor.service";
import { classifyOrderFailure, classifyVendorStatus } from "./vcgamers-status";
import {
  TVCgamerResponse,
  TVCGamerProduct,
  TVCGamerProductVariant,
  TVCGamerProductVariantResponse,
  TVCGamerOrderRequest,
  TVCGamerOrderResponse,
  TVCGamersOrderStatusResponse,
} from "../../types/vcgamer-api.types";
import { PrismaService } from "../../../../prisma/prisma.service";
import { VendorAPICacheService } from "../../../../valkey/services/vendor-api-cache.service";
import * as crypto from "crypto";

interface VCGamersProductResponse {
  key: string;
  name: string;
  image_url: string;
  description?: string;
  is_voucher: boolean;
  is_active: boolean;
  forms?: Array<{
    key: string;
    type: string;
    alias: string;
    options?: string[];
  }>;
}

@Injectable()
export class VCGamersService extends BaseVendorService {
  readonly vendorName = "vcGamer";

  constructor(
    configService: ConfigService,
    prisma: PrismaService,
    vendorAPICacheService: VendorAPICacheService,
  ) {
    super(configService, prisma, vendorAPICacheService, "vcGamer");
  }

  protected createSignature(params: string): string {
    try {
      if (!this.config.apiSecret) {
        throw new Error("API secret is not configured");
      }

      if (!params || params.trim() === "") {
        throw new Error("Signature parameters cannot be empty");
      }

      this.logger.debug("Creating signature for VCGamers request", {
        paramsLength: params.length,
        hasApiSecret: !!this.config.apiSecret,
      });

      const hmac = crypto
        .createHmac("sha512", this.config.apiSecret)
        .update(params)
        .digest("hex");

      const signature = Buffer.from(hmac).toString("base64");

      this.logger.debug("Successfully created signature", {
        signatureLength: signature.length,
      });

      return signature;
    } catch (error) {
      this.logger.error("Failed to create signature", {
        error: error.message,
        hasApiSecret: !!this.config.apiSecret,
        paramsProvided: !!params,
      });
      throw new Error(`Signature generation failed: ${error.message}`);
    }
  }

  async getProducts(): Promise<TVCgamerResponse<TVCGamerProduct[]>> {
    const params = `${this.config.apiSecret}brand`;
    const signature = this.createSignature(params);
    const response = await this.makeRequest<VCGamersProductResponse[]>(
      "GET",
      `/v2/public/brands?sign=${signature}`,
    );

    console.log(
      "Raw VCGamers Products Response:",
      JSON.stringify(response, null, 2),
    );

    if (!response.success || !response.data) {
      return {
        ...response,
        data: [],
      };
    }

    return {
      ...response,
      data: response.data as unknown as TVCGamerProduct[],
    };
  }

  async getProductVariants(
    brandKey: string,
  ): Promise<TVCgamerResponse<TVCGamerProductVariant[]>> {
    const params = `${this.config.apiSecret}variation${brandKey}`;
    const signature = this.createSignature(params);
    const response = await this.makeRequest<TVCGamerProductVariantResponse>(
      "GET",
      `/v2/public/variations?brand_key=${brandKey}&sign=${signature}`,
    );

    console.log(
      "Raw VCGamers Variants Response:",
      JSON.stringify(response, null, 2),
    );

    if (!response.success || !response.data) {
      return {
        ...response,
        data: [],
      };
    }

    return {
      success: response.success,
      statusCode: response.statusCode,
      message: response.message,
      data: response.data.data || [],
      error: response.error,
    };
  }

  async createOrder(
    brandKey: string,
    variationKey: string,
    price: number,
    data: Array<{ key: string; value: string }>,
    customRefId?: string,
  ): Promise<TVCgamerResponse<TVCGamerOrderResponse>> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const refId = customRefId || this.generateUniqueRefId();

    const orderData: TVCGamerOrderRequest = {
      brand_key: brandKey,
      variation_key: variationKey,
      price,
      data,
      ref_id: refId,
      timestamp,
    };

    const params = `${this.config.apiSecret}order${brandKey}${variationKey}${price}${refId}${timestamp}`;
    const signature = this.createSignature(params);

    const response = await this.makeRequest<TVCGamerOrderResponse>(
      "POST",
      `/v2/public/order?sign=${signature}`,
      orderData,
    );

    console.log(
      "Raw VCGamers Order Response:",
      JSON.stringify(response, null, 2),
    );

    if (!response.success) {
      return {
        ...response,
        data: undefined,
      };
    }

    return {
      success: response.success,
      statusCode: response.statusCode,
      message: response.message,
      data: response.data,
      error: response.error,
    };
  }

  // ── Fulfilment port ────────────────────────────────────────────────

  async checkOrder(vendorRefId: string): Promise<VendorOrderStatus> {
    const resp = await this.getOrderStatus(vendorRefId);
    if (!resp.success || !resp.data?.data) {
      return {
        outcome: "pending",
        raw: null,
        reason: `${resp.statusCode}: ${resp.message}`,
        response: resp,
        unavailable: true,
      };
    }
    const verdict = classifyVendorStatus(resp.data.data);
    return { ...verdict, response: resp.data };
  }

  classifyOrderFailure(
    resp: TVCgamerResponse<TVCGamerOrderResponse>,
  ): VendorOrderFailure {
    return classifyOrderFailure(resp);
  }

  async getOrderStatus(
    transactionCode: string,
  ): Promise<TVCgamerResponse<TVCGamersOrderStatusResponse>> {
    try {
      if (!transactionCode || transactionCode.trim() === "") {
        this.logger.error(
          "Invalid transaction code provided for order status check",
          {
            transactionCode,
          },
        );
        return {
          success: false,
          statusCode: 400,
          message: "Invalid transaction code",
          error: "Transaction code is required and cannot be empty",
        };
      }

      const params = `${this.config.apiSecret}orderstatus${transactionCode}`;
      let signature: string;

      try {
        signature = this.createSignature(params);
      } catch (signatureError) {
        this.logger.error(
          "Failed to create signature for order status request",
          {
            transactionCode,
            error: signatureError.message,
          },
        );
        return {
          success: false,
          statusCode: 401,
          message: "Authentication signature generation failed",
          error: "Unable to generate authentication signature",
        };
      }

      this.logger.debug("Making order status request to VCGamers", {
        transactionCode,
        endpoint: `/v2/public/order-status?tid=${transactionCode}&sign=${signature}`,
      });

      const response = await this.makeRequest<TVCGamersOrderStatusResponse>(
        "GET",
        `/v2/public/order-status?tid=${transactionCode}&sign=${signature}`,
      );

      this.logger.debug("VCGamers order status response received", {
        transactionCode,
        success: response.success,
        statusCode: response.statusCode,
        hasData: !!response.data,
      });

      if (!response.success) {
        this.logger.warn("VCGamers order status request failed", {
          transactionCode,
          statusCode: response.statusCode,
          error: response.error,
          originalError: response.originalError,
        });

        return {
          ...response,
          data: undefined,
        };
      }

      if (!response.data || typeof response.data !== "object") {
        this.logger.error("Invalid response data structure from VCGamers", {
          transactionCode,
          responseData: response.data,
        });

        return {
          success: false,
          statusCode: 502,
          message: "Invalid vendor response format",
          error: "Vendor returned invalid response structure",
          originalError: {
            message: "Invalid response data structure",
            responseData: response.data,
          },
        };
      }

      this.logger.log("Successfully retrieved order status from VCGamers", {
        transactionCode,
        status: response.data.data?.status,
        statusCode: response.statusCode,
      });

      return {
        success: response.success,
        statusCode: response.statusCode,
        message: response.message,
        data: response.data,
        error: response.error,
        originalError: response.originalError,
      };
    } catch (error) {
      this.logger.error("Unexpected error in getOrderStatus", {
        transactionCode,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        statusCode: 500,
        message: "Unexpected error occurred while checking order status",
        error: error.message || "Unknown error",
        originalError: {
          message: error.message,
          type: "unexpected_error",
        },
      };
    }
  }
}
