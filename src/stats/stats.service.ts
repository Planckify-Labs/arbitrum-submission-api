import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface DashboardStats {
  totalUsers: number;
  totalTransactions: number;
  totalPurchases: number;
  activePurchases: number;
  recentTransactions: Array<{
    id: string;
    userId: string;
    amount: string;
    status: string;
    type: string;
    senderAddress: string | null;
    recipientAddress: string | null;
    createdAt: Date;
    token?: {
      symbol: string;
      name: string;
    } | null;
  }>;
  queueStats: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats(): Promise<DashboardStats> {
    const [
      totalUsers,
      totalTransactions,
      totalPurchases,
      activePurchases,
      recentTransactions,
      purchasesByStatus,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.transactionHistory.count(),
      this.prisma.purchase.count(),
      this.prisma.purchase.count({
        where: {
          status: { in: ["PENDING", "PROCESSING"] },
        },
      }),
      this.prisma.transactionHistory.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          token: {
            select: {
              symbol: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.purchase.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
    ]);

    // Build queue stats from purchase statuses
    const statusCounts = Object.fromEntries(
      purchasesByStatus.map((s) => [s.status, s._count.status]),
    );

    return {
      totalUsers,
      totalTransactions,
      totalPurchases,
      activePurchases,
      recentTransactions: recentTransactions.map((tx) => ({
        id: tx.id,
        userId: tx.userId,
        amount: tx.amount.toString(),
        status: tx.status,
        type: tx.type,
        senderAddress: tx.senderAddress,
        recipientAddress: tx.recipientAddress,
        createdAt: tx.createdAt,
        token: tx.token
          ? { symbol: tx.token.symbol, name: tx.token.name }
          : null,
      })),
      queueStats: {
        waiting: statusCounts["PENDING"] || 0,
        active: statusCounts["PROCESSING"] || 0,
        completed: statusCounts["COMPLETED"] || 0,
        failed: statusCounts["FAILED"] || 0,
        delayed: statusCounts["REFUNDED"] || 0,
      },
    };
  }
}
