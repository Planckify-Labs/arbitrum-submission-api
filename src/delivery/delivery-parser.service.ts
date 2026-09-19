import { Injectable, Logger } from "@nestjs/common";
import { DeliveryType } from "@generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  DeliveryPayload,
  ParseInput,
  isVoucherTemplate,
} from "./delivery.types";
import { maskVoucher, voucherSignature } from "./delivery-signature";
import { parsePln } from "./parsers/pln.parser";
import { parseWithTemplate } from "./parsers/template.parser";
import { parseHeuristic } from "./parsers/heuristic.parser";

type CustomerInfoEntry = { key: string; value: unknown };

/**
 * Turns whatever the vendor put in `voucher_code` into the one
 * `DeliveryPayload` shape mobile renders. Tiers, first match wins:
 *
 *   1. `Product.voucherTemplate` — positional, ops-editable, no deploy.
 *   2. Code parsers for formats too messy for a template (PLN).
 *   3. Heuristic split for shapes nobody has looked at yet.
 *   4. Raw only.
 *
 * Whatever tier wins, `raw` is always carried so the client can show it
 * and the backfill script can re-parse when a better tier appears.
 */
@Injectable()
export class DeliveryParserService {
  private readonly logger = new Logger(DeliveryParserService.name);

  constructor(private readonly prisma: PrismaService) {}

  parse(input: ParseInput): DeliveryPayload {
    const raw = input.raw?.trim() || null;
    const target = this.extractTarget(input.customerInfo, input.deliveryType);

    switch (input.deliveryType) {
      case DeliveryType.VOUCHER_CODE:
        return this.parseVoucher(input.productCode, raw, input.template);
      case DeliveryType.BILL_PAYMENT: {
        // Receipts are key/value-ish; the heuristic tier labels them and
        // the raw block covers whatever it misses.
        const parsed: Pick<
          DeliveryPayload,
          "primary" | "fields" | "parse" | "parserId"
        > = raw
          ? parseHeuristic(raw)
          : { primary: undefined, fields: [], parse: "none", parserId: null };
        const fields = parsed.primary
          ? [
              { ...parsed.primary, label: parsed.primary.label || "Reference" },
              ...parsed.fields,
            ]
          : parsed.fields;
        return {
          kind: "bill",
          primary: undefined,
          fields,
          raw,
          parse: parsed.parse,
          parserId: parsed.parserId,
          target,
        };
      }
      case DeliveryType.EMAIL:
      case DeliveryType.DIRECT_TOPUP:
      default:
        return {
          kind: input.deliveryType === DeliveryType.EMAIL ? "email" : "topup",
          fields: raw
            ? [{ label: "Vendor reference", value: raw, copyable: true }]
            : [],
          raw,
          parse: raw ? "exact" : "none",
          parserId: null,
          target,
        };
    }
  }

  /**
   * `parse` + record the shape for the ops dashboard. The record is
   * best-effort: a failed upsert must never fail a delivery.
   */
  async parseAndRecord(input: ParseInput): Promise<DeliveryPayload> {
    const payload = this.parse(input);
    if (payload.raw && input.deliveryType === DeliveryType.VOUCHER_CODE) {
      await this.recordShape(input.productCode, payload.raw, payload.parse);
    }
    return payload;
  }

  private parseVoucher(
    productCode: string,
    raw: string | null,
    template: ParseInput["template"],
  ): DeliveryPayload {
    if (!raw) {
      return {
        kind: "voucher",
        fields: [],
        raw: null,
        parse: "none",
        parserId: null,
      };
    }

    if (isVoucherTemplate(template)) {
      const fromTemplate = parseWithTemplate(raw, template, productCode);
      if (fromTemplate) return fromTemplate;
      this.logger.warn(
        `[delivery] template for ${productCode} did not match (${template.fields.length} fields expected)`,
      );
    }

    const pln = parsePln(raw);
    if (pln) return pln;

    return parseHeuristic(raw);
  }

  private async recordShape(
    productCode: string,
    raw: string,
    parseTier: DeliveryPayload["parse"],
  ): Promise<void> {
    const signature = voucherSignature(raw);
    try {
      const row = await this.prisma.voucherShape.upsert({
        where: { productCode_signature: { productCode, signature } },
        create: {
          productCode,
          signature,
          parseTier,
          sampleMasked: maskVoucher(raw),
        },
        update: { parseTier, count: { increment: 1 }, lastSeenAt: new Date() },
      });
      if (
        row.count === 1 &&
        parseTier !== "exact" &&
        parseTier !== "template"
      ) {
        // First order of a shape no parser knows — the moment ops should
        // eyeball the masked sample and write a template.
        this.logger.warn(
          `[delivery] NEW voucher shape for ${productCode} on tier=${parseTier}: ${row.sampleMasked}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[delivery] could not record voucher shape for ${productCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private extractTarget(
    customerInfo: unknown,
    deliveryType: DeliveryType,
  ): string | undefined {
    const entries = this.normaliseCustomerInfo(customerInfo);
    if (entries.length === 0) return undefined;

    const preferred =
      deliveryType === DeliveryType.EMAIL
        ? /email|mail/i
        : /phone|hp|msisdn|nomor|number|user|id|meter|account|customer/i;

    const hit =
      entries.find((e) => preferred.test(e.key) && this.isScalar(e.value)) ??
      entries.find((e) => this.isScalar(e.value));
    return hit ? String(hit.value) : undefined;
  }

  private normaliseCustomerInfo(customerInfo: unknown): CustomerInfoEntry[] {
    if (!customerInfo) return [];
    if (Array.isArray(customerInfo)) {
      return customerInfo
        .filter(
          (e): e is CustomerInfoEntry =>
            !!e &&
            typeof e === "object" &&
            typeof (e as CustomerInfoEntry).key === "string",
        )
        .map((e) => ({ key: e.key, value: e.value }));
    }
    if (typeof customerInfo === "object") {
      return Object.entries(customerInfo as Record<string, unknown>).map(
        ([key, value]) => ({ key, value }),
      );
    }
    return [];
  }

  private isScalar(value: unknown): boolean {
    return (
      (typeof value === "string" && value.trim().length > 0) ||
      typeof value === "number"
    );
  }
}
