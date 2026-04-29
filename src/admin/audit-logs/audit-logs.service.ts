import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListAuditLogsArgs {
  action?: string;
  userId?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
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
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(args: ListAuditLogsArgs) {
    const take = clampTake(args.take);
    const useSkip = typeof args.skip === "number" && args.skip > 0;
    const baseWhere = this.buildWhere(args);

    let where: Record<string, unknown> = baseWhere;
    if (args.cursor && !useSkip) {
      const cursorRow = await this.prisma.adminAuditLog.findFirst({
        where: { id: args.cursor },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      });
      if (cursorRow) {
        const cursorClause = {
          OR: [
            { createdAt: { lt: cursorRow.createdAt } },
            {
              AND: [
                { createdAt: cursorRow.createdAt },
                { id: { lt: cursorRow.id } },
              ],
            },
          ],
        };
        where =
          baseWhere && Object.keys(baseWhere).length > 0
            ? { AND: [baseWhere, cursorClause] }
            : cursorClause;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        take,
        ...(useSkip ? { skip: args.skip } : {}),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        where,
        include: { adminUser: { select: USER_SAFE_SELECT } },
      }),
      this.prisma.adminAuditLog.count({ where: baseWhere }),
    ]);

    return { items: rows.map((row) => this.toResponse(row)), total };
  }

  async findOne(id: string) {
    const row = await this.prisma.adminAuditLog.findFirst({
      where: { id },
      include: { adminUser: { select: USER_SAFE_SELECT } },
    });
    if (!row) {
      throw new NotFoundException({
        message: `Audit log '${id}' not found.`,
        code: "AUDIT_LOG_NOT_FOUND",
      });
    }
    return this.toResponse(row);
  }

  private buildWhere(args: ListAuditLogsArgs) {
    const and: Record<string, unknown>[] = [];

    if (args.action) {
      and.push({ action: args.action });
    }
    if (args.userId) {
      and.push({ adminUserId: args.userId });
    }
    if (args.entityType) {
      and.push({ resource: args.entityType });
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

    return and.length > 0 ? { AND: and } : {};
  }

  private toResponse(row: {
    id: string;
    adminUserId: string;
    action: string;
    resource: string;
    resourceId: string | null;
    metadata: unknown;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    adminUser?: {
      id: string;
      username: string | null;
      email: string | null;
      walletAddress: string | null;
    } | null;
  }) {
    return {
      id: row.id,
      action: row.action,
      entityType: row.resource,
      entityId: row.resourceId ?? "",
      userId: row.adminUserId,
      metadata:
        row.metadata && typeof row.metadata === "object" ? row.metadata : null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      user: row.adminUser
        ? {
            id: row.adminUser.id,
            username: row.adminUser.username,
            email: row.adminUser.email,
            walletAddress: row.adminUser.walletAddress,
          }
        : undefined,
    };
  }
}

function clampTake(take: number | undefined): number {
  if (!take || Number.isNaN(take)) return 10;
  if (take < 1) return 1;
  if (take > 100) return 100;
  return Math.floor(take);
}
