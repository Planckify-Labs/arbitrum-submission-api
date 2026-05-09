import type { PrismaService } from "../prisma/prisma.service";
import { StatsService } from "./stats.service";

describe("StatsService.getDashboardStats", () => {
  it("aggregates counts and groups purchase statuses into queue stats", async () => {
    const prisma = {
      user: { count: jest.fn(async () => 50) },
      transactionHistory: {
        count: jest.fn(async () => 200),
        findMany: jest.fn(async () => [
          {
            id: "tx_1",
            userId: "u_1",
            amount: BigInt(100),
            status: "COMPLETED",
            type: "PAYMENT",
            senderAddress: "0xS",
            recipientAddress: "0xR",
            createdAt: new Date(),
            token: { symbol: "USDC", name: "USD Coin" },
          },
        ]),
      },
      purchase: {
        count: jest
          .fn()
          .mockResolvedValueOnce(80) // total
          .mockResolvedValueOnce(5), // active (PENDING + PROCESSING)
        groupBy: jest.fn(async () => [
          { status: "PENDING", _count: { status: 3 } },
          { status: "PROCESSING", _count: { status: 2 } },
          { status: "COMPLETED", _count: { status: 70 } },
          { status: "FAILED", _count: { status: 4 } },
          { status: "REFUNDED", _count: { status: 1 } },
        ]),
      },
    } as unknown as PrismaService;

    const svc = new StatsService(prisma);
    const out = await svc.getDashboardStats();
    expect(out.totalUsers).toBe(50);
    expect(out.totalTransactions).toBe(200);
    expect(out.totalPurchases).toBe(80);
    expect(out.activePurchases).toBe(5);
    expect(out.queueStats).toEqual({
      waiting: 3,
      active: 2,
      completed: 70,
      failed: 4,
      delayed: 1,
    });
    expect(out.recentTransactions[0].amount).toBe("100");
    expect(out.recentTransactions[0].token?.symbol).toBe("USDC");
  });

  it("zero-fills queueStats when groupBy returns no rows", async () => {
    const prisma = {
      user: { count: jest.fn(async () => 0) },
      transactionHistory: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      purchase: {
        count: jest.fn(async () => 0),
        groupBy: jest.fn(async () => []),
      },
    } as unknown as PrismaService;
    const svc = new StatsService(prisma);
    const out = await svc.getDashboardStats();
    expect(out.queueStats).toEqual({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    });
  });
});
