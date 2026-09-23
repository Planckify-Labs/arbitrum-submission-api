import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { PushService } from "../push/push.service";
import type { TokenIconService } from "../tokens/token-icon.service";
import { TransactionsService } from "./transactions.service";

// PushService pulls in expo-server-sdk, which ships pure ESM and isn't
// transformed by Jest's default config. Nothing here ever instantiates
// the real PushService, so a trivial stub avoids Jest ever parsing it.
jest.mock("expo-server-sdk", () => ({ Expo: class {} }));

const pushServiceStub = {
  stageToWallet: jest.fn(async () => ({
    attempted: 0,
    notificationLogId: null,
  })),
  enqueue: jest.fn(async () => undefined),
  sendToWallet: jest.fn(async () => ({
    attempted: 0,
    notificationLogId: null,
  })),
  sendToUser: jest.fn(async () => ({ attempted: 0, notificationLogId: null })),
} as unknown as PushService;

// TokenIconService pulls in sharp (native libvips) and Valkey; the transfer
// push only needs its pure `pushImageUrl` mapping, so a stub that mirrors
// the real contract (icon route for a logo, undefined without) is enough.
const tokenIconStub = {
  pushImageUrl: jest.fn((token: { id: string; logoUrl: string | null }) =>
    token.logoUrl
      ? `https://api.example.test/tokens/${token.id}/icon.png?v=abc123`
      : undefined,
  ),
  warm: jest.fn(),
} as unknown as TokenIconService;

/**
 * TransactionsService unit tests.
 *
 * The service runs against a TimescaleDB hypertable so cursor pagination is
 * createdAt-based (not id-based) and updates use the composite PK
 * `id_createdAt`. These tests pin both contracts so a refactor that drops
 * either invariant fails loudly.
 */

function buildPrismaStub(
  opts: {
    txs?: Record<string, unknown>[];
    user?: Record<string, unknown> | null;
    blockchain?: Record<string, unknown> | null;
    token?: Record<string, unknown> | null;
    purchases?: Record<string, unknown>[];
    intent?: Record<string, unknown> | null;
    cursorTx?: Record<string, unknown> | null;
  } = {},
) {
  const txs = opts.txs ?? [];
  const findMany = jest.fn(async () => txs);
  const count = jest.fn(async () => txs.length);
  const findFirst = jest.fn(async ({ where }: { where: { id?: string } }) => {
    if (opts.cursorTx !== undefined && where?.id) return opts.cursorTx;
    return txs.find((t) => (t as { id: string }).id === where?.id) ?? null;
  });

  const prisma = {
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
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return prisma as unknown as PrismaService;
}

describe("TransactionsService.create", () => {
  it("persists exactly the wire fields and returns the row with token included", async () => {
    const prisma = buildPrismaStub();
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);

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

    const create = (prisma.transactionHistory.create as jest.Mock).mock
      .calls[0][0];
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

describe("TransactionsService.create — transfer notifications", () => {
  function buildTransferPrismaStub(
    tokenOverrides: Record<string, unknown> = {},
    opts: {
      earlierRow?: { id: string } | null;
      contacts?: { address: string; label: string }[];
    } = {},
  ) {
    const prisma = {
      addressBook: {
        findMany: jest.fn(async () => opts.contacts ?? []),
      },
      transactionHistory: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: "tx_transfer",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            ...data,
            token: {
              id: data.tokenId,
              symbol: "USDC",
              decimals: 6,
              ...tokenOverrides,
            },
          }),
        ),
        findFirst: jest.fn(async () => opts.earlierRow ?? null),
      },
      // Interactive transaction: the callback gets the same client, and
      // `tx` identity is what the tests use to prove the push was staged
      // inside the history row's own transaction.
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    return prisma as unknown as PrismaService;
  }

  /** A PushService stub with the two-phase (stage, enqueue) API. */
  function buildPushStub(
    staged = { attempted: 1, notificationLogId: "log_1" },
  ) {
    const stageToWallet = jest.fn(async () => staged);
    const enqueue = jest.fn(async () => undefined);
    return {
      push: {
        stageToWallet,
        enqueue,
        sendToWallet: jest.fn(),
        sendToUser: jest.fn(),
      } as unknown as PushService,
      stageToWallet,
      enqueue,
    };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it("stages the recipient's push inside the history row's transaction, then enqueues it after commit", async () => {
    const prisma = buildTransferPrismaStub();
    const { push, stageToWallet, enqueue } = buildPushStub();
    const svc = new TransactionsService(prisma, push, tokenIconStub);

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "TRANSFER",
      amount: "5000000",
      txHash: "0xhash",
      fromAddress: "0xSENDER",
      toAddress: "0xRECIPIENT",
    } as never);

    expect(stageToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0xRECIPIENT",
        body: expect.stringContaining("5 USDC"),
        channelId: "transfers",
        source: "transfer",
        data: {
          type: "transfer",
          transactionId: "tx_transfer",
          senderAddress: "0xSENDER",
          recipientAddress: "0xRECIPIENT",
          tokenSymbol: "USDC",
        },
      }),
      prisma, // the `tx` handed to the $transaction callback
    );
    await flush();
    expect(enqueue).toHaveBeenCalledWith({
      attempted: 1,
      notificationLogId: "log_1",
    });
  });

  it("names the sender by the recipient's saved contact, not the address", async () => {
    const sender = "0x9f83e8d1c3b0a2e4f5a6b7c8d9e0f1a2dbb8e94f";
    const recipient = "0x425e71b2c3d4e5f6a7b8c9d0e1f2a3b40ce69fc9";
    const prisma = buildTransferPrismaStub(
      {},
      // Saved with different casing than the transfer carries.
      {
        contacts: [
          { address: sender.toUpperCase().replace("0X", "0x"), label: "Alice" },
        ],
      },
    );
    const { push, stageToWallet } = buildPushStub();
    const svc = new TransactionsService(prisma, push, tokenIconStub);

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "TRANSFER",
      amount: "50000000",
      txHash: "0xhash",
      fromAddress: sender,
      toAddress: recipient,
    } as never);

    expect(stageToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "You received 50 USDC from Alice to 0x425e71...0ce69fc9.",
      }),
      prisma,
    );
    // The recipient's book, looked up by the recipient's canonical address.
    expect(
      (prisma as unknown as { addressBook: { findMany: jest.Mock } })
        .addressBook.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user: { walletAddress: "0x425e71B2c3d4E5F6a7B8C9d0e1f2A3b40CE69fC9" },
        },
      }),
    );
  });

  it("does not ring the recipient twice when the same on-chain transfer is recorded again", async () => {
    const prisma = buildTransferPrismaStub(
      {},
      { earlierRow: { id: "tx_first" } },
    );
    const { push, stageToWallet, enqueue } = buildPushStub();
    const svc = new TransactionsService(prisma, push, tokenIconStub);

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "TRANSFER",
      amount: "5000000",
      txHash: "0xhash",
      fromAddress: "0xSENDER",
      toAddress: "0xRECIPIENT",
    } as never);

    expect(prisma.transactionHistory.findFirst).toHaveBeenCalledWith({
      where: {
        txHash: "0xhash",
        type: "TRANSFER",
        recipientAddress: "0xRECIPIENT",
        tokenId: "tk_usdc",
        id: { not: "tx_transfer" },
      },
      select: { id: true },
    });
    expect(stageToWallet).not.toHaveBeenCalled();
    await flush();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips the duplicate check when the client sent no txHash", async () => {
    const prisma = buildTransferPrismaStub();
    const { push, stageToWallet } = buildPushStub();
    const svc = new TransactionsService(prisma, push, tokenIconStub);

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "TRANSFER",
      amount: "5000000",
      fromAddress: "0xSENDER",
      toAddress: "0xRECIPIENT",
    } as never);

    expect(prisma.transactionHistory.findFirst).not.toHaveBeenCalled();
    expect(stageToWallet).toHaveBeenCalledTimes(1);
  });

  it("embeds the token's push-safe icon URL from TokenIconService, not the raw logoUrl", async () => {
    const { push, stageToWallet } = buildPushStub();
    // An SVG logo is the shape that used to reach the device raw and render
    // no icon at all; it must now route through the PNG endpoint.
    const svc = new TransactionsService(
      buildTransferPrismaStub({
        logoUrl: "https://cdn.example.com/tokens/AUSD/logo.svg",
      }),
      push,
      tokenIconStub,
    );

    await svc.create("user_1", {
      tokenId: "tk_ausd",
      type: "TRANSFER",
      amount: "1000000",
      fromAddress: "0xSENDER",
      toAddress: "0xRECIPIENT",
    } as never);

    expect(tokenIconStub.pushImageUrl).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tk_ausd" }),
    );
    // Pre-warmed once the row is committed, so the device's fetch hits cache.
    expect(tokenIconStub.warm).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tk_ausd" }),
    );
    expect(stageToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://api.example.test/tokens/tk_ausd/icon.png?v=abc123",
      }),
      expect.anything(),
    );
  });

  it("sends the push without an image when the token has no logo", async () => {
    const { push, stageToWallet } = buildPushStub();
    const svc = new TransactionsService(
      buildTransferPrismaStub({ logoUrl: null }),
      push,
      tokenIconStub,
    );

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "TRANSFER",
      amount: "1000000",
      fromAddress: "0xSENDER",
      toAddress: "0xRECIPIENT",
    } as never);

    expect(stageToWallet).toHaveBeenCalledTimes(1);
    const args = (stageToWallet.mock.calls[0] as unknown[])[0] as {
      imageUrl?: string;
    };
    expect(args.imageUrl).toBeUndefined();
  });

  it("shows truncated sender and recipient addresses in the body", async () => {
    const { push, stageToWallet } = buildPushStub();
    const svc = new TransactionsService(
      buildTransferPrismaStub(),
      push,
      tokenIconStub,
    );

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "TRANSFER",
      amount: "1000000",
      fromAddress: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
      toAddress: "0xffeeddccbbaa99887766554433221100ffeeddcc",
    } as never);

    expect(stageToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("0x1a2b3c...7e8f9a0b"),
      }),
      expect.anything(),
    );
    expect(stageToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("0xffeedd...ffeeddcc"),
      }),
      expect.anything(),
    );
  });

  it("does not push when sender and recipient are the same wallet (self-transfer)", async () => {
    const { push, stageToWallet } = buildPushStub();
    const svc = new TransactionsService(
      buildTransferPrismaStub(),
      push,
      tokenIconStub,
    );

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "TRANSFER",
      amount: "1000000",
      fromAddress: "0xSAME",
      toAddress: "0xsame",
    } as never);

    expect(stageToWallet).not.toHaveBeenCalled();
  });

  it("does not push for non-TRANSFER types (e.g. PAYMENT)", async () => {
    const { push, stageToWallet } = buildPushStub();
    const svc = new TransactionsService(
      buildTransferPrismaStub(),
      push,
      tokenIconStub,
    );

    await svc.create("user_1", {
      tokenId: "tk_usdc",
      type: "PAYMENT",
      amount: "1000000",
      fromAddress: "0xA",
      toAddress: "0xB",
    } as never);

    expect(stageToWallet).not.toHaveBeenCalled();
  });

  it("nothing to notify when the recipient wallet has no devices, but the record still commits", async () => {
    const prisma = buildTransferPrismaStub();
    const { push, enqueue } = buildPushStub({
      attempted: 0,
      notificationLogId: "log_no_device",
    });
    const svc = new TransactionsService(prisma, push, tokenIconStub);

    await expect(
      svc.create("user_1", {
        tokenId: "tk_usdc",
        type: "TRANSFER",
        amount: "1000000",
        fromAddress: "0xSENDER",
        toAddress: "0xNOBODY",
      } as never),
    ).resolves.toMatchObject({ id: "tx_transfer" });
    await flush();
    // Handed over anyway — `enqueue` is the one that knows a no-device row
    // has nothing to dispatch.
    expect(enqueue).toHaveBeenCalledWith({
      attempted: 0,
      notificationLogId: "log_no_device",
    });
  });

  it("a push staging failure never rolls back or fails the sender's own record", async () => {
    const prisma = buildTransferPrismaStub();
    const push = {
      stageToWallet: jest.fn(() => Promise.reject(new Error("network blip"))),
      enqueue: jest.fn(),
      sendToWallet: jest.fn(),
      sendToUser: jest.fn(),
    } as unknown as PushService;
    const svc = new TransactionsService(prisma, push, tokenIconStub);

    await expect(
      svc.create("user_1", {
        tokenId: "tk_usdc",
        type: "TRANSFER",
        amount: "1000000",
        fromAddress: "0xSENDER",
        toAddress: "0xRECIPIENT",
      } as never),
    ).resolves.toMatchObject({ id: "tx_transfer" });
    expect(push.enqueue).not.toHaveBeenCalled();
  });

  it("a failing enqueue is swallowed — the committed outbox row is the sweeper's problem now", async () => {
    const prisma = buildTransferPrismaStub();
    const { push, enqueue } = buildPushStub();
    enqueue.mockRejectedValueOnce(new Error("redis down"));
    const svc = new TransactionsService(prisma, push, tokenIconStub);

    await expect(
      svc.create("user_1", {
        tokenId: "tk_usdc",
        type: "TRANSFER",
        amount: "1000000",
        fromAddress: "0xSENDER",
        toAddress: "0xRECIPIENT",
      } as never),
    ).resolves.toMatchObject({ id: "tx_transfer" });
    await flush();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("TransactionsService.findAll", () => {
  it("uses createdAt-based cursor pagination on the hypertable", async () => {
    const prisma = buildPrismaStub({
      cursorTx: { createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await svc.findAll({ cursor: "tx_after", take: 25 });

    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findMany.where.createdAt.lt).toBeInstanceOf(Date);
    expect(findMany.take).toBe(25);
    expect(findMany.orderBy).toEqual({ createdAt: "desc" });
  });

  it("falls back to skip pagination when skip > 0 (and ignores cursor)", async () => {
    const prisma = buildPrismaStub();
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await svc.findAll({ skip: 30, take: 10, cursor: "tx_x" });
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findMany.skip).toBe(30);
    expect(findMany.where).toEqual({});
  });

  it("returns empty where clause when no cursor and no skip", async () => {
    const prisma = buildPrismaStub();
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await svc.findAll({});
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findMany.where).toEqual({});
  });
});

describe("TransactionsService.findOne", () => {
  it("404s when no transaction matches the id", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce(
      null,
    );
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await expect(svc.findOne("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("returns the row including blockchain + user details", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "tx_x",
      createdAt: new Date(),
      token: { blockchain: { name: "Polygon" } },
      user: { id: "u" },
    });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    const out = await svc.findOne("tx_x");
    expect(out.id).toBe("tx_x");
  });
});

describe("TransactionsService.findPaymentDetail", () => {
  it("404s when transaction missing", async () => {
    const prisma = buildPrismaStub();
    (prisma.transactionHistory.findFirst as jest.Mock).mockResolvedValueOnce(
      null,
    );
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
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
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
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
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
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
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
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
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await svc.updateStatus("tx_u", { status: "COMPLETED" } as never);

    const update = (prisma.transactionHistory.update as jest.Mock).mock
      .calls[0][0];
    expect(update.where).toEqual({
      id_createdAt: { id: "tx_u", createdAt: baseDate },
    });
    expect(update.data).toEqual({ status: "COMPLETED" });
  });
});

describe("TransactionsService.findByUser / findByBlockchain / findByToken", () => {
  it("findByUser 404s when user missing", async () => {
    const prisma = buildPrismaStub({ user: null });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await expect(svc.findByUser("u")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("findByBlockchain 404s when blockchain missing", async () => {
    const prisma = buildPrismaStub({ blockchain: null });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await expect(svc.findByBlockchain("bc_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("findByToken 404s when token missing", async () => {
    const prisma = buildPrismaStub({ token: null });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await expect(svc.findByToken("tk_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("findByUser scopes findMany on userId and uses createdAt cursor", async () => {
    const prisma = buildPrismaStub({
      user: { id: "u" },
      cursorTx: { createdAt: new Date("2026-02-02T00:00:00Z") },
    });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    await svc.findByUser("u", { cursor: "tx_x" });
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock
      .calls[0][0];
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
      purchases: [{ transactionId: "tx_a", productVariant: { name: "X" } }],
    });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
    const out = await svc.findUserTransactionHistory("u", "PAYMENT");
    expect(out).toHaveLength(2);
    expect(out[0].purchase).toBeDefined();
    expect(out[1].purchase).toBeNull();
  });
});

describe("TransactionsService.search", () => {
  it("composes filters (type, status, txHash, range) into where + uses cursor on hypertable", async () => {
    const prisma = buildPrismaStub({
      txs: [{ id: "tx_p", type: "PAYMENT", createdAt: new Date(), token: {} }],
      cursorTx: { createdAt: new Date("2026-03-01T00:00:00Z") },
    });
    const svc = new TransactionsService(prisma, pushServiceStub, tokenIconStub);
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
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock
      .calls[0][0];
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
