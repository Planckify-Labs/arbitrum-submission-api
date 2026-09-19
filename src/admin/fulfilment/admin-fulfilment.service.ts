import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FulfilmentRefundStatus,
  FulfilmentStatus,
  Prisma,
} from "@generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { FulfilmentService } from "../../fulfilment/fulfilment.service";
import { FulfilmentKind } from "../../fulfilment/fulfilment.types";
import { PointsRefundService } from "../../points/points-refund.service";
import { DeliveryParserService } from "../../delivery/delivery-parser.service";
import {
  isVoucherTemplate,
  VoucherTemplate,
} from "../../delivery/delivery.types";
import { parseWithTemplate } from "../../delivery/parsers/template.parser";
import { DeliveryType } from "@generated/prisma";

const DEFAULT_LIMIT = 50;

/** One row shape for both kinds in the ops list. */
export interface AdminOrderRow {
  kind: FulfilmentKind;
  id: string;
  fulfilmentStatus: FulfilmentStatus;
  fulfilmentError: string | null;
  vendorRefId: string | null;
  productCode: string;
  productName: string;
  variantName: string;
  buyer: string;
  createdAt: string;
  updatedAt: string;
  expectedBy: string | null;
  vendorLastCheckedAt: string | null;
  vendorCheckCount: number;
  deliveredAfterRefundAt: string | null;
  refund: { id: string; status: FulfilmentRefundStatus; points: string } | null;
}

@Injectable()
export class AdminFulfilmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfilment: FulfilmentService,
    private readonly refunds: PointsRefundService,
    private readonly parser: DeliveryParserService,
  ) {}

  // ── orders ────────────────────────────────────────────────────────

  async listOrders(input: {
    status?: FulfilmentStatus;
    kind?: FulfilmentKind;
    limit?: number;
  }): Promise<AdminOrderRow[]> {
    const status = input.status ?? FulfilmentStatus.NEEDS_RECONCILE;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const rows: AdminOrderRow[] = [];

    if (input.kind !== "redemption") {
      const purchases = await this.prisma.purchase.findMany({
        where: { fulfilmentStatus: status },
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          bookingOrder: { select: { walletAddress: true } },
          productVariant: {
            select: {
              name: true,
              product: { select: { code: true, name: true } },
            },
          },
          refund: { select: { id: true, status: true, points: true } },
        },
      });
      rows.push(
        ...purchases.map((p) => ({
          kind: "purchase" as const,
          id: p.id,
          fulfilmentStatus: p.fulfilmentStatus,
          fulfilmentError: p.fulfilmentError,
          vendorRefId: p.vendorRefId,
          productCode: p.productVariant.product.code,
          productName: p.productVariant.product.name,
          variantName: p.productVariant.name,
          buyer: p.bookingOrder.walletAddress,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          expectedBy: p.expectedBy?.toISOString() ?? null,
          vendorLastCheckedAt: p.vendorLastCheckedAt?.toISOString() ?? null,
          vendorCheckCount: p.vendorCheckCount,
          deliveredAfterRefundAt:
            p.deliveredAfterRefundAt?.toISOString() ?? null,
          refund: p.refund
            ? {
                id: p.refund.id,
                status: p.refund.status,
                points: p.refund.points.toString(),
              }
            : null,
        })),
      );
    }

    if (input.kind !== "purchase") {
      const redemptions = await this.prisma.pointRedemption.findMany({
        where: { fulfilmentStatus: status },
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          productVariant: {
            select: {
              name: true,
              product: { select: { code: true, name: true } },
            },
          },
          refund: { select: { id: true, status: true, points: true } },
        },
      });
      rows.push(
        ...redemptions.map((r) => ({
          kind: "redemption" as const,
          id: r.id,
          fulfilmentStatus: r.fulfilmentStatus,
          fulfilmentError: r.fulfilmentError,
          vendorRefId: r.vendorRefId,
          productCode: r.productVariant.product.code,
          productName: r.productVariant.product.name,
          variantName: r.productVariant.name,
          buyer: r.userId,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          expectedBy: r.expectedBy?.toISOString() ?? null,
          vendorLastCheckedAt: r.vendorLastCheckedAt?.toISOString() ?? null,
          vendorCheckCount: r.vendorCheckCount,
          deliveredAfterRefundAt:
            r.deliveredAfterRefundAt?.toISOString() ?? null,
          refund: r.refund
            ? {
                id: r.refund.id,
                status: r.refund.status,
                points: r.refund.points.toString(),
              }
            : null,
        })),
      );
    }

    return rows
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  /** Ask the vendor right now, outside the backoff chain. */
  async checkOrder(kind: FulfilmentKind, id: string) {
    const status = await this.fulfilment.check(kind, id, { reschedule: false });
    return { kind, id, fulfilmentStatus: status };
  }

  async resolveOrder(
    kind: FulfilmentKind,
    id: string,
    input: {
      outcome: "delivered" | "failed";
      note: string;
      raw?: string;
      adminId: string;
    },
  ) {
    const status = await this.fulfilment.resolveManually(kind, id, {
      outcome: input.outcome,
      adminId: input.adminId,
      note: input.note,
      raw: input.raw,
    });
    return { kind, id, fulfilmentStatus: status };
  }

  // ── refunds ───────────────────────────────────────────────────────

  async listRefunds(input: {
    status?: FulfilmentRefundStatus;
    limit?: number;
  }) {
    const rows = await this.prisma.fulfilmentRefund.findMany({
      where: { status: input.status ?? FulfilmentRefundStatus.PENDING_REVIEW },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? DEFAULT_LIMIT,
      include: {
        user: { select: { id: true, walletAddress: true, email: true } },
        purchase: {
          select: {
            productVariant: {
              select: { name: true, product: { select: { name: true } } },
            },
          },
        },
        redemption: {
          select: {
            productVariant: {
              select: { name: true, product: { select: { name: true } } },
            },
          },
        },
      },
    });
    return rows.map((r) => {
      const variant =
        r.purchase?.productVariant ?? r.redemption?.productVariant;
      return {
        id: r.id,
        status: r.status,
        target: r.purchaseId
          ? { kind: "purchase", id: r.purchaseId }
          : { kind: "redemption", id: r.redemptionId },
        user: r.user,
        points: r.points.toString(),
        fiatAmount: r.fiatAmount?.toString() ?? null,
        currency: r.currency,
        source: r.source,
        reason: r.reason,
        vendorError: r.vendorError,
        holdReason: r.holdReason,
        productCode: r.productCode,
        product: variant
          ? `${variant.product.name} ${variant.name}`.trim()
          : null,
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  approveRefund(id: string, adminId: string, note?: string) {
    return this.refunds.approve(id, adminId, note);
  }

  rejectRefund(id: string, adminId: string, note: string) {
    return this.refunds.reject(id, adminId, note);
  }

  reverseRefund(id: string, adminId: string, note: string) {
    return this.refunds.reverse(id, adminId, note);
  }

  // ── voucher shapes / templates ────────────────────────────────────

  listShapes(input: { tier?: string; productCode?: string; limit?: number }) {
    return this.prisma.voucherShape.findMany({
      where: {
        ...(input.tier ? { parseTier: input.tier } : {}),
        ...(input.productCode ? { productCode: input.productCode } : {}),
      },
      orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }],
      take: input.limit ?? 100,
    });
  }

  async setVoucherTemplate(
    productCode: string,
    template: VoucherTemplate | null,
    adminId: string,
  ) {
    if (template !== null && !isVoucherTemplate(template)) {
      throw new BadRequestException(
        "template.primary must index into template.fields and separator must be non-empty",
      );
    }
    const product = await this.prisma.product.findUnique({
      where: { code: productCode },
      select: { id: true, voucherTemplate: true },
    });
    if (!product)
      throw new NotFoundException(`Product ${productCode} not found`);

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: {
          voucherTemplate:
            template === null
              ? Prisma.DbNull
              : (template as unknown as Prisma.InputJsonValue),
          // A template is only ever for a code product.
          ...(template ? { deliveryType: DeliveryType.VOUCHER_CODE } : {}),
        },
      });
      await tx.adminAuditLog.create({
        data: {
          adminUser: { connect: { id: adminId } },
          action: template ? "VOUCHER_TEMPLATE_SET" : "VOUCHER_TEMPLATE_CLEAR",
          resource: "Product",
          resourceId: product.id,
          oldValues: {
            voucherTemplate: product.voucherTemplate,
          } as Prisma.InputJsonValue,
          newValues: {
            voucherTemplate: template,
          } as unknown as Prisma.InputJsonValue,
          metadata: { productCode } as Prisma.InputJsonValue,
        },
      });
    });
    return { productCode, template };
  }

  /** Dry-run a template against a raw code — what mobile would render. */
  previewTemplate(productCode: string, template: VoucherTemplate, raw: string) {
    if (!isVoucherTemplate(template)) {
      throw new BadRequestException("invalid template");
    }
    const withTemplate = parseWithTemplate(raw, template, productCode);
    const fallback = this.parser.parse({
      productCode,
      deliveryType: DeliveryType.VOUCHER_CODE,
      raw,
      template: null,
    });
    return {
      matched: withTemplate !== null,
      result: withTemplate ?? fallback,
      segments: raw.split(template.separator).map((s) => s.trim()),
    };
  }
}
