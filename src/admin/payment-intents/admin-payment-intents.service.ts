import { Injectable, NotFoundException } from "@nestjs/common";
import {
  PaymentIntentStatus as PrismaPaymentIntentStatus,
} from "@generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";

export type DashboardPaymentIntentStatus =
  | "PENDING"
  | "COMPLETED"
  | "EXPIRED"
  | "FAILED";

export interface ListAdminPaymentIntentsArgs {
  status?: DashboardPaymentIntentStatus;
  merchantId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  cursor?: string;
  take?: number;
  skip?: number;
}

const MERCHANT_SELECT = {
  id: true,
  displayName: true,
} as const;

@Injectable()
export class AdminPaymentIntentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(args: ListAdminPaymentIntentsArgs) {
    const take = clampTake(args.take);
    const useSkip = typeof args.skip === "number" && args.skip > 0;
    const where = this.buildWhere(args);

    const findArgs = {
      take,
      skip: useSkip ? args.skip : args.cursor ? 1 : 0,
      cursor: useSkip ? undefined : args.cursor ? { id: args.cursor } : undefined,
    };

    const [rows, total] = await Promise.all([
      this.prisma.paymentIntent.findMany({
        ...findArgs,
        orderBy: { createdAt: "desc" },
        where,
        include: {
          merchant: { select: MERCHANT_SELECT },
        },
      }),
      this.prisma.paymentIntent.count({ where }),
    ]);

    return { items: rows.map((row) => this.toResponse(row)), total };
  }

  async findOne(id: string) {
    const row = await this.prisma.paymentIntent.findUnique({
      where: { id },
      include: {
        merchant: { select: MERCHANT_SELECT },
        _count: { select: { nanopaySubmissions: true, payouts: true } },
      },
    });
    if (!row) {
      throw new NotFoundException({
        message: `Payment intent '${id}' not found.`,
        code: "PAYMENT_INTENT_NOT_FOUND",
      });
    }
    return this.toResponse(row, {
      submissions: row._count?.nanopaySubmissions ?? 0,
      payouts: row._count?.payouts ?? 0,
    });
  }

  async listSubmissions(intentId: string) {
    await this.requireIntent(intentId);
    const where = { intentId };
    const [rows, total] = await Promise.all([
      this.prisma.nanopaySubmission.findMany({
        where,
        orderBy: { submittedAt: "desc" },
      }),
      this.prisma.nanopaySubmission.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        intentId: row.intentId,
        txHash: row.circleSettleTxUuid ?? "",
        amount: "0",
        status: row.failureCode ? "FAILED" : "SUBMITTED",
        createdAt: row.submittedAt.toISOString(),
      })),
      total,
    };
  }

  async listPayouts(intentId: string) {
    await this.requireIntent(intentId);
    const where = { intentId };
    const [rows, total] = await Promise.all([
      this.prisma.providerPayout.findMany({
        where,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.providerPayout.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        intentId: row.intentId,
        externalId: row.providerPayoutId ?? row.referenceId,
        amount: row.amount.toString(),
        status: row.status,
        accountNumber: maskAccount(row.accountNumberEncrypted),
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  private async requireIntent(id: string) {
    const exists = await this.prisma.paymentIntent.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException({
        message: `Payment intent '${id}' not found.`,
        code: "PAYMENT_INTENT_NOT_FOUND",
      });
    }
  }

  private buildWhere(args: ListAdminPaymentIntentsArgs) {
    const and: Record<string, unknown>[] = [];

    if (args.status) {
      and.push({ status: { in: dashboardStatusToPrisma(args.status) } });
    }

    if (args.merchantId) {
      and.push({ merchantId: args.merchantId });
    }

    if (args.dateFrom || args.dateTo) {
      const range: { gte?: Date; lte?: Date } = {};
      if (args.dateFrom) {
        const d = new Date(args.dateFrom);
        if (!Number.isNaN(d.getTime())) range.gte = d;
      }
      if (args.dateTo) {
        const d = new Date(args.dateTo);
        if (!Number.isNaN(d.getTime())) range.lte = d;
      }
      if (range.gte || range.lte) {
        and.push({ createdAt: range });
      }
    }

    if (args.search) {
      const q = args.search;
      and.push({
        OR: [
          { id: { contains: q, mode: "insensitive" } },
          { merchantId: { contains: q, mode: "insensitive" } },
          { fxFromCurrency: { contains: q, mode: "insensitive" } },
          { fxToCurrency: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private toResponse(
    row: {
      id: string;
      merchantId: string;
      fiatAmountMinor: number;
      fiatCurrency: string;
      status: PrismaPaymentIntentStatus;
      createdAt: Date;
      updatedAt: Date;
      expiresAt: Date | null;
      merchant?: { id: string; displayName: string } | null;
    },
    counts?: { submissions: number; payouts: number },
  ) {
    const completedAt =
      row.status === "PAID_OUT" || row.status === "SETTLED"
        ? row.updatedAt
        : null;

    return {
      id: row.id,
      merchantId: row.merchantId,
      amount: minorToDecimalString(row.fiatAmountMinor, row.fiatCurrency),
      currency: row.fiatCurrency,
      status: prismaStatusToDashboard(row.status),
      reference: null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      completedAt: completedAt ? completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      merchant: row.merchant
        ? {
            id: row.merchant.id,
            businessName: row.merchant.displayName,
          }
        : undefined,
      ...(counts ? { _count: counts } : {}),
    };
  }
}

function clampTake(take: number | undefined): number {
  if (!take || Number.isNaN(take)) return 10;
  if (take < 1) return 1;
  if (take > 100) return 100;
  return Math.floor(take);
}

function prismaStatusToDashboard(
  status: PrismaPaymentIntentStatus,
): DashboardPaymentIntentStatus {
  switch (status) {
    case "QUOTED":
    case "SIGNED":
      return "PENDING";
    case "SETTLED":
    case "PAID_OUT":
      return "COMPLETED";
    case "EXPIRED":
      return "EXPIRED";
    case "FAILED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

function dashboardStatusToPrisma(
  status: DashboardPaymentIntentStatus,
): PrismaPaymentIntentStatus[] {
  switch (status) {
    case "PENDING":
      return ["QUOTED", "SIGNED"];
    case "COMPLETED":
      return ["SETTLED", "PAID_OUT"];
    case "EXPIRED":
      return ["EXPIRED"];
    case "FAILED":
      return ["FAILED"];
    default:
      return [];
  }
}

function minorToDecimalString(amountMinor: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  if (decimals === 0) return amountMinor.toString();
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const factor = Math.pow(10, decimals);
  const whole = Math.floor(abs / factor).toString();
  const frac = (abs % factor).toString().padStart(decimals, "0");
  return `${sign}${whole}.${frac}`;
}

function currencyDecimals(currency: string): number {
  const upper = currency.toUpperCase();
  if (upper === "IDR" || upper === "VND" || upper === "JPY") return 0;
  return 2;
}

function maskAccount(buf: Uint8Array | Buffer | null | undefined): string {
  if (!buf) return "";
  try {
    const utf8 = Buffer.from(buf).toString("utf8");
    if (utf8.length <= 4) return utf8.padStart(4, "•");
    return `••••${utf8.slice(-4)}`;
  } catch {
    return "";
  }
}
