import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { TransactionsService } from "./transactions.service";

/**
 * TransactionsService unit tests.
 *
 * The service runs against a TimescaleDB hypertable so cursor pagination is
 * createdAt-based (not id-based) and updates use the composite PK
 * `id_createdAt`. These tests pin both contracts so a refactor that drops
 * either invariant fails loudly.
 */

function buildPrismaStub(opts: {
  txs?: Record<string, unknown>[];
  user?: Record<string, unknown> | null;
  blockchain?: Record<string, unknown> | null;
  token?: Record<string, unknown> | null;
  purchases?: Record<string, unknown>[];
  intent?: Record<string, unknown> | null;
  cursorTx?: Record<string, unknown> | null;
} = {}) {
  const txs = opts.txs ?? [];
  const findMany = jest.fn(async () => txs);
  const count = jest.fn(async () => txs.length);
  const findFirst = jest.fn(async ({ where }: { where: { id?: string } }) => {
    if (opts.cursorTx !== undefined && where?.id) return opts.cursorTx;
    return txs.find((t) => (t as { id: string }).id === where?.id) ?? null;
  });

  return {
    transactionHistory: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "tx_001",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        ...data,
        token: { id: data.tokenId },
      })),
      findMany,
      findFirst,
      count,
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "tx_001",
        ...data,
        token: { id: data.tokenId },
      })),
    },
    user: { findUnique: jest.fn(async () => opts.user ?? null) },
    blockchain: { findUnique: jest.fn(async () => opts.blockchain ?? null) },
    token: { findUnique: jest.fn(async () => opts.token ?? null) },
    purchase: { findMany: jest.fn(async () => opts.purchases ?? []) },
    paymentIntent: { findUnique: jest.fn(async () => opts.intent ?? null) },
  } as unknown as PrismaService;
}

describe("TransactionsService.create", () => {
  it("persists exactly the wire fields and returns the row with token included", async () => {
    const prisma = buildPrismaStub();
    const svc = new TransactionsService(prisma);

    const result = await svc.create("user_1", {
      tokenId: "tk_1",
      type: "PAYMENT",
      status: "PENDING",
      amount: "100",
      amountInFiat: "1500000",
      fiatCurrency: "IDR",
      txHash: "0xhash",
      fromAddress: "0xFROM",
      toAddress: "0xTO",
      merchantName: "Toko Bu Sari",
      paymentIntentId: "pi_1",
    } as never);

    const create = (prisma.transactionHistory.create as jest.Mock).mock.calls[0][0];
    expect(create.data).toMatchObject({
      userId: "user_1",
      tokenId: "tk_1",
      type: "PAYMENT",
      status: "PENDING",
      amount: "100",
      amountInFiat: "1500000",
      fiatCurrency: "IDR",
      txHash: "0xhash",
      senderAddress: "0xFROM",
      recipientAddress: "0xTO",
      merchantName: "Toko Bu Sari",
      paymentIntentId: "pi_1",
    });
    expect(create.include).toEqual({ token: true });
    expect(result.id).toBe("tx_001");
  });
});

describe("TransactionsService.findAll", () => {
  it("uses createdAt-based cursor pagination on the hypertable", async () => {
    const prisma = buildPrismaStub({
      cursorTx: { createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    const svc = new TransactionsService(prisma);
    await svc.findAll({ cursor: "tx_after", take: 25 });

    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.createdAt.lt).toBeInstanceOf(Date);
    expect(findMany.take).toBe(25);
    expect(findMany.orderBy).toEqual({ createdAt: "desc" });
  });

  it("falls back to skip pagination when skip > 0 (and ignores cursor)", async () => {
    const prisma = buildPrismaStub();
    const svc = new TransactionsService(prisma);
    await svc.findAll({ skip: 30, take: 10, cursor: "tx_x" });
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(30);
    expect(findMany.where).toEqual({});
  });

  it("returns empty where clause when no cursor and no skip", async () => {
    const prisma = buildPrismaStub();
    const svc = new TransactionsService(prisma);
    await svc.findAll({});
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where).toEqual({});
  });
});

describe("TransactionsService.findOne", () => {
  it("404s when no transaction matches the id", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const svc = new TransactionsService(prisma);
    await expect(svc.findOne("missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns the row including blockchain + user details", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "tx_x",
      createdAt: new Date(),
      token: { blockchain: { name: "Polygon" } },
      user: { id: "u" },
    });
    const svc = new TransactionsService(prisma);
    const out = await svc.findOne("tx_x");
    expect(out.id).toBe("tx_x");
  });
});

describe("TransactionsService.findPaymentDetail", () => {
  it("404s when transaction missing", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const svc = new TransactionsService(prisma);
    await expect(svc.findPaymentDetail("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("404s when transaction is not type=PAYMENT", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "tx_y",
      type: "DEPOSIT",
      paymentIntentId: null,
    });
    const svc = new TransactionsService(prisma);
    await expect(svc.findPaymentDetail("tx_y")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("attaches the linked payment-intent merchant context when present", async () => {
    const prisma = buildPrismaStub({
      intent: {
        fiatAmountMinor: 100000,
        fiatCurrency: "IDR",
        merchant: { displayName: "Toko", country: "ID" },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1_000),
      },
    });
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "tx_z",
      type: "PAYMENT",
      paymentIntentId: "pi_attached",
    });
    const svc = new TransactionsService(prisma);
    const out = await svc.findPaymentDetail("tx_z");
    expect(out.intent?.merchant?.displayName).toBe("Toko");
  });

  it("returns intent=null when paymentIntentId is null", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "tx_z2",
      type: "PAYMENT",
      paymentIntentId: null,
    });
    const svc = new TransactionsService(prisma);
    const out = await svc.findPaymentDetail("tx_z2");
    expect(out.intent).toBeNull();
  });
});

describe("TransactionsService.updateStatus", () => {
  it("uses the composite PK id_createdAt for the hypertable update", async () => {
    const prisma = buildPrismaStub();
    const baseDate = new Date("2026-01-01T00:00:00Z");
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "tx_u",
      createdAt: baseDate,
    });
    const svc = new TransactionsService(prisma);
    await svc.updateStatus("tx_u", { status: "COMPLETED" } as never);

    const update = (prisma.transactionHistory.update as jest.Mock).mock.calls[0][0];
    expect(update.where).toEqual({
      id_createdAt: { id: "tx_u", createdAt: baseDate },
    });
    expect(update.data).toEqual({ status: "COMPLETED" });
  });
});

describe("TransactionsService.findByUser / findByBlockchain / findByToken", () => {
  it("findByUser 404s when user missing", async () => {
    const prisma = buildPrismaStub({ user: null });
    const svc = new TransactionsService(prisma);
    await expect(svc.findByUser("u")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("findByBlockchain 404s when blockchain missing", async () => {
    const prisma = buildPrismaStub({ blockchain: null });
    const svc = new TransactionsService(prisma);
    await expect(svc.findByBlockchain("bc_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("findByToken 404s when token missing", async () => {
    const prisma = buildPrismaStub({ token: null });
    const svc = new TransactionsService(prisma);
    await expect(svc.findByToken("tk_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("findByUser scopes findMany on userId and uses createdAt cursor", async () => {
    const prisma = buildPrismaStub({
      user: { id: "u" },
      cursorTx: { createdAt: new Date("2026-02-02T00:00:00Z") },
    });
    const svc = new TransactionsService(prisma);
    await svc.findByUser("u", { cursor: "tx_x" });
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.userId).toBe("u");
    expect(findMany.where.createdAt.lt).toBeInstanceOf(Date);
  });
});

describe("TransactionsService.findUserTransactionHistory", () => {
  it("filters by type and joins purchase rows manually (hypertable has no relation)", async () => {
    const prisma = buildPrismaStub({
      txs: [
        {
          id: "tx_a",
          type: "PAYMENT",
          createdAt: new Date(),
          token: { blockchain: { name: "Polygon" } },
        },
        {
          id: "tx_b",
          type: "PAYMENT",
          createdAt: new Date(),
          token: { blockchain: { name: "Polygon" } },
        },
      ],
      purchases: [
        { transactionId: "tx_a", productVariant: { name: "X" } },
      ],
    });
    const svc = new TransactionsService(prisma);
    const out = await svc.findUserTransactionHistory("u", "PAYMENT");
    expect(out).toHaveLength(2);
    expect(out[0].purchase).toBeDefined();
    expect(out[1].purchase).toBeNull();
  });
});

describe("TransactionsService.search", () => {
  it("composes filters (type, status, txHash, range) into where + uses cursor on hypertable", async () => {
    const prisma = buildPrismaStub({
      txs: [
        { id: "tx_p", type: "PAYMENT", createdAt: new Date(), token: {} },
      ],
      cursorTx: { createdAt: new Date("2026-03-01T00:00:00Z") },
    });
    const svc = new TransactionsService(prisma);
    const result = await svc.search(
      {
        type: "PAYMENT",
        status: "COMPLETED",
        txHash: "0xabcd",
        senderAddress: "0xSENDER",
        recipientAddress: "0xRECIP",
        minAmount: "1",
        maxAmount: "1000",
        startDate: "2026-01-01",
        endDate: "2026-04-01",
      } as never,
      { cursor: "tx_after", take: 5 },
    );
    expect(result.items).toHaveLength(1);
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.type).toBe("PAYMENT");
    expect(findMany.where.status).toBe("COMPLETED");
    expect(findMany.where.txHash).toEqual({
      equals: "0xabcd",
      mode: "insensitive",
    });
    expect(findMany.where.amount.gte).toBe("1");
    expect(findMany.where.amount.lte).toBe("1000");
    expect(findMany.where.createdAt.gte).toBeInstanceOf(Date);
    expect(findMany.where.createdAt.lt).toBeInstanceOf(Date);
  });
});
