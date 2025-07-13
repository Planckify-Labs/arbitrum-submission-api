import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  TVCGamerAPIConfig,
  TVCgamerResponse,
  TVCGamerProduct,
  TVCGamerProductVariant,
} from "../types/vcgamer-api.types";
import { PrismaService } from "../../../prisma/prisma.service";
import * as crypto from "crypto";

@Injectable()
export abstract class BaseVendorService {
  protected readonly logger = new Logger(this.constructor.name);
  protected config: TVCGamerAPIConfig;

  constructor(
    protected readonly configService: ConfigService,
    protected readonly prisma: PrismaService,
    vendorName: string,
  ) {
    this.initializeConfig(vendorName);
  }

  private async initializeConfig(vendorName: string): Promise<void> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { name: vendorName },
      include: { VendorAPI: true },
    });

    if (!vendor || !vendor.VendorAPI?.[0]) {
      throw new Error(`Vendor ${vendorName} configuration not found`);
    }

    const api = vendor.VendorAPI[0];
    this.config = {
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      apiSecret: api.apiSecret || undefined,
      vendorId: vendor.id,
    };
  }

  protected abstract createSignature(params: string): string;

  protected async makeRequest<T>(
    method: string,
    endpoint: string,
    data?: unknown,
    retries = 3,
  ): Promise<TVCgamerResponse<T>> {
    try {
      const url = `${this.config.baseUrl}${endpoint}`;
      const headers = {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      console.log("Making VCGamers API Request:", {
        url,
        method,
        headers,
        data: data || undefined,
      });

      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
      });

      const responseData = await response.json();
      console.log(
        "VCGamers API Response:",
        JSON.stringify(responseData, null, 2),
      );

      if (!response.ok) {
        throw new Error(
          responseData.message || `HTTP error! status: ${response.status}`,
        );
      }

      return {
        success: true,
        statusCode: response.status,
        message: "Success",
        data: responseData,
      };
    } catch (error) {
      if (retries > 0) {
        this.logger.warn(
          `Request failed, retrying... (${retries} attempts left)`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.makeRequest(method, endpoint, data, retries - 1);
      }

      return {
        success: false,
        statusCode: error.status || 500,
        message: error.message,
        error: error.message,
      };
    }
  }

  abstract getProducts(): Promise<TVCgamerResponse<TVCGamerProduct[]>>;
  abstract getProductVariants(
    productId: string,
  ): Promise<TVCgamerResponse<TVCGamerProductVariant[]>>;
}
