import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseVendorService } from "../../base/base-vendor.service";
import {
  TVCgamerResponse,
  TVCGamerProduct,
  TVCGamerProductVariant,
  TVCGamerProductVariantResponse,
} from "../../types/vcgamer-api.types";
import { PrismaService } from "../../../../prisma/prisma.service";
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
  constructor(configService: ConfigService, prisma: PrismaService) {
    super(configService, prisma, "vcGamer");
  }

  protected createSignature(params: string): string {
    console.log("Creating signature with params:", params);
    const hmac = crypto
      .createHmac("sha512", this.config.apiSecret || "")
      .update(params)
      .digest("hex");
    return Buffer.from(hmac).toString("base64");
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
}
