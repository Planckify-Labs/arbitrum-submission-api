import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export type AdminMerchantStatus = "ACTIVE" | "INACTIVE" | "PENDING";

export interface ListAdminMerchantsArgs {
  status?: AdminMerchantStatus;
  search?: string;
  cursor?: string;
  take?: number;
  skip?: number;
}

const USER_SAFE_SELECT = {
  id: true,
  username: true,
  email: true,
  walletAddress: true,
} as const;

@Injectable()
export class AdminMerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(args: ListAdminMerchantsArgs) {
    const take = clampTake(args.take);
    const useSkip = typeof args.skip === "number" && args.skip > 0;
    const where = this.buildWhere(args);

    const findArgs = {
      take,
      skip: useSkip ? args.skip : args.cursor ? 1 : 0,
      cursor: useSkip ? undefined : args.cursor ? { id: args.cursor } : undefined,
    };

    const [rows, total] = await Promise.all([
      this.prisma.merchant.findMany({
        ...findArgs,
        orderBy: { createdAt: "desc" },
        where,
        include: {
          user: { select: USER_SAFE_SELECT },
          _count: { select: { paymentIntents: true } },
        },
      }),
      this.prisma.merchant.count({ where }),
    ]);

    return { items: rows.map((row) => this.toResponse(row)), total };
  }

  async findOne(id: string) {
    const row = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        user: { select: USER_SAFE_SELECT },
        _count: { select: { paymentIntents: true } },
      },
    });
    if (!row) {
      throw new NotFoundException({
        message: `Merchant '${id}' not found.`,
        code: "MERCHANT_NOT_FOUND",
      });
    }
    return this.toResponse(row);
  }

  async updateStatus(id: string, status: AdminMerchantStatus) {
    const existing = await this.prisma.merchant.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: `Merchant '${id}' not found.`,
        code: "MERCHANT_NOT_FOUND",
      });
    }
    if (status !== "ACTIVE" && status !== "INACTIVE" && status !== "PENDING") {
      throw new BadRequestException({
        message:
          "status must be one of ACTIVE, INACTIVE, PENDING.",
        code: "MERCHANT_STATUS_INVALID",
      });
    }

    const updated = await this.prisma.merchant.update({
      where: { id },
      data: { isActive: status === "ACTIVE" },
      include: {
        user: { select: USER_SAFE_SELECT },
        _count: { select: { paymentIntents: true } },
      },
    });

    return this.toResponse(updated, status);
  }

  private buildWhere(args: ListAdminMerchantsArgs) {
    const and: Record<string, unknown>[] = [];

    if (args.status === "ACTIVE") {
      and.push({ isActive: true });
    } else if (args.status === "INACTIVE") {
      and.push({ isActive: false });
    }

    if (args.search) {
      const q = args.search;
      and.push({
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { contactPhone: { contains: q, mode: "insensitive" } },
          { qrisPan: { contains: q, mode: "insensitive" } },
          { user: { is: { email: { contains: q, mode: "insensitive" } } } },
          { user: { is: { username: { contains: q, mode: "insensitive" } } } },
        ],
      });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private toResponse(
    row: {
      id: string;
      userId: string | null;
      displayName: string;
      jwsQr: string;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      user?: {
        id: string;
        username: string | null;
        email: string | null;
        walletAddress: string | null;
      } | null;
      _count?: { paymentIntents: number };
    },
    statusOverride?: AdminMerchantStatus,
  ) {
    const status: AdminMerchantStatus =
      statusOverride ?? (row.isActive ? "ACTIVE" : "INACTIVE");
    return {
      id: row.id,
      userId: row.userId ?? "",
      businessName: row.displayName,
      qrJws: row.jwsQr ?? null,
      status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      user: row.user
        ? {
            id: row.user.id,
            username: row.user.username,
            email: row.user.email,
            walletAddress: row.user.walletAddress,
          }
        : undefined,
      _count: {
        transactions: row._count?.paymentIntents ?? 0,
      },
    };
  }
}

function clampTake(take: number | undefined): number {
  if (!take || Number.isNaN(take)) return 10;
  if (take < 1) return 1;
  if (take > 100) return 100;
  return Math.floor(take);
}
