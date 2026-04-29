import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { UpdateTransactionDto } from "./dto/update-transaction.dto";
import { SearchTransactionDto } from "./dto/search-transaction.dto";
import { Prisma, TransactionType } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createTransactionDto: CreateTransactionDto) {
    return await this.prisma.transactionHistory.create({
      data: {
        userId,
        tokenId: createTransactionDto.tokenId,
        type: createTransactionDto.type,
        status: createTransactionDto.status,
        amount: createTransactionDto.amount,
        amountInFiat: createTransactionDto.amountInFiat,
        fiatCurrency: createTransactionDto.fiatCurrency,
        txHash: createTransactionDto.txHash,
        senderAddress: createTransactionDto.fromAddress,
        recipientAddress: createTransactionDto.toAddress,
        merchantName: createTransactionDto.merchantName,
        paymentIntentId: createTransactionDto.paymentIntentId,
      },
      include: {
        token: true,
      },
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;

    // For hypertable with composite PK, use createdAt-based cursor pagination
    let cursorDate: Date | undefined;
    if (cursor && !useSkip) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      cursorDate = cursorTx?.createdAt;
    }

    const where: Prisma.TransactionHistoryWhereInput = cursorDate
      ? { createdAt: { lt: cursorDate } }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.transactionHistory.findMany({
        take,
        ...(useSkip ? { skip } : {}),
        where,
        include: {
          token: true,
          user: {
            select: {
              id: true,
              walletAddress: true,
              username: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      this.prisma.transactionHistory.count(),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    // Use findFirst for hypertable with composite PK (id alone is indexed but not unique constraint)
    const transaction = await this.prisma.transactionHistory.findFirst({
      where: { id },
      include: {
        token: {
          include: {
            blockchain: true,
          },
        },
        user: {
          select: {
            id: true,
            walletAddress: true,
            username: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    return transaction;
  }

  async findPaymentDetail(id: string) {
    const transaction = await this.prisma.transactionHistory.findFirst({
      where: { id },
      include: {
        token: {
          include: {
            blockchain: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    if (transaction.type !== "PAYMENT") {
      throw new NotFoundException(
        `Transaction ${id} is not a merchant payment`,
      );
    }

    let intentDetail: {
      fiatAmountMinor: number;
      fiatCurrency: string;
      merchant: { displayName: string; country: string } | null;
      createdAt: Date;
      expiresAt: Date;
    } | null = null;

    if (transaction.paymentIntentId) {
      const intent = await this.prisma.paymentIntent.findUnique({
        where: { id: transaction.paymentIntentId },
        select: {
          fiatAmountMinor: true,
          fiatCurrency: true,
          createdAt: true,
          expiresAt: true,
          merchant: {
            select: {
              displayName: true,
              country: true,
            },
          },
        },
      });
      intentDetail = intent;
    }

    return {
      ...transaction,
      intent: intentDetail,
    };
  }

  async updateStatus(id: string, updateTransactionDto: UpdateTransactionDto) {
    const transaction = await this.findOne(id);

    return await this.prisma.transactionHistory.update({
      where: {
        id_createdAt: {
          id: transaction.id,
          createdAt: transaction.createdAt,
        },
      },
      data: updateTransactionDto,
      include: {
        token: true,
      },
    });
  }

  async findByUser(userId: string, paginationDto: CursorPaginationDto = {}) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const { cursor, take = 50, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;

    let cursorDate: Date | undefined;
    if (cursor && !useSkip) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      cursorDate = cursorTx?.createdAt;
    }

    const where: Prisma.TransactionHistoryWhereInput = {
      userId,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.transactionHistory.findMany({
        where,
        take,
        ...(useSkip ? { skip } : {}),
        include: {
          token: true,
          user: {
            select: {
              id: true,
              walletAddress: true,
              username: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      this.prisma.transactionHistory.count({ where: { userId } }),
    ]);

    return { items, total };
  }

  async findByBlockchain(
    blockchainId: string,
    paginationDto: CursorPaginationDto = {},
  ) {
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: blockchainId },
    });

    if (!blockchain) {
      throw new NotFoundException(
        `Blockchain with ID ${blockchainId} not found`,
      );
    }

    const { cursor, take = 50, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;

    let cursorDate: Date | undefined;
    if (cursor && !useSkip) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      cursorDate = cursorTx?.createdAt;
    }

    const baseWhere: Prisma.TransactionHistoryWhereInput = {
      token: { blockchainId },
    };

    const where: Prisma.TransactionHistoryWhereInput = {
      ...baseWhere,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.transactionHistory.findMany({
        where,
        take,
        ...(useSkip ? { skip } : {}),
        include: {
          token: true,
          user: {
            select: {
              id: true,
              walletAddress: true,
              username: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      this.prisma.transactionHistory.count({ where: baseWhere }),
    ]);

    return { items, total };
  }

  async findByToken(tokenId: string, paginationDto: CursorPaginationDto = {}) {
    const token = await this.prisma.token.findUnique({
      where: { id: tokenId },
    });

    if (!token) {
      throw new NotFoundException(`Token with ID ${tokenId} not found`);
    }

    const { cursor, take = 50, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;

    let cursorDate: Date | undefined;
    if (cursor && !useSkip) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      cursorDate = cursorTx?.createdAt;
    }

    const baseWhere: Prisma.TransactionHistoryWhereInput = { tokenId };
    const where: Prisma.TransactionHistoryWhereInput = {
      ...baseWhere,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.transactionHistory.findMany({
        where,
        take,
        ...(useSkip ? { skip } : {}),
        include: {
          token: true,
          user: {
            select: {
              id: true,
              walletAddress: true,
              username: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      this.prisma.transactionHistory.count({ where: baseWhere }),
    ]);

    return { items, total };
  }

  async findUserTransactionHistory(
    userId: string,
    type?: TransactionType,
    paginationDto?: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto || {};

    const where: Prisma.TransactionHistoryWhereInput = {
      userId,
    };

    if (type) {
      where.type = type;
    }

    // For hypertable with composite PK, use createdAt-based cursor pagination
    if (cursor) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorTx) {
        where.createdAt = { lt: cursorTx.createdAt };
      }
    }

    const transactions = await this.prisma.transactionHistory.findMany({
      take,
      where,
      include: {
        token: {
          select: {
            blockchain: {
              select: {
                name: true,
                blockExplorer: true,
                tokens: {
                  where: {
                    isNativeCurrency: true,
                    isActive: true,
                  },
                },
              },
            },
            contractAddress: true,
            name: true,
            symbol: true,
            decimals: true,
            logoUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Purchase has no Prisma relation to TransactionHistory (hypertable).
    // Post-fetch associated purchases and attach them manually.
    const txIds = transactions.map((t) => t.id);
    const purchases = await this.prisma.purchase.findMany({
      where: { transactionId: { in: txIds } },
      include: {
        productVariant: {
          select: {
            name: true,
            product: {
              select: {
                id: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });
    const purchaseByTxId = new Map(purchases.map((p) => [p.transactionId, p]));

    return transactions.map((t) => ({
      ...t,
      purchase: purchaseByTxId.get(t.id) ?? null,
    }));
  }

  async search(
    searchParams: SearchTransactionDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;
    const {
      type,
      status,
      userId,
      tokenId,
      senderAddress,
      recipientAddress,
      txHash,
      minAmount,
      maxAmount,
      startDate,
      endDate,
    } = searchParams;

    const where: Prisma.TransactionHistoryWhereInput = {};

    if (type) where.type = type;
    if (status) where.status = status;
    if (userId) where.userId = userId;
    if (tokenId) where.tokenId = tokenId;

    if (senderAddress) {
      where.senderAddress = {
        equals: senderAddress,
        mode: "insensitive",
      };
    }
    if (recipientAddress) {
      where.recipientAddress = {
        equals: recipientAddress,
        mode: "insensitive",
      };
    }

    if (txHash) {
      where.txHash = {
        equals: txHash,
        mode: "insensitive",
      };
    }

    if (minAmount || maxAmount) {
      where.amount = {};
      if (minAmount) where.amount.gte = minAmount;
      if (maxAmount) where.amount.lte = maxAmount;
    }

    if (startDate || endDate) {
      where.createdAt = where.createdAt || {};
      if (startDate)
        (where.createdAt as Prisma.DateTimeFilter).gte = new Date(startDate);
      if (endDate)
        (where.createdAt as Prisma.DateTimeFilter).lte = new Date(endDate);
    }

    const baseWhere = { ...where } as Prisma.TransactionHistoryWhereInput;

    // For hypertable with composite PK, use createdAt-based cursor pagination
    if (cursor && !useSkip) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorTx) {
        where.createdAt = where.createdAt || {};
        (where.createdAt as Prisma.DateTimeFilter).lt = cursorTx.createdAt;
      }
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transactionHistory.findMany({
        take,
        ...(useSkip ? { skip } : {}),
        where,
        include: {
          token: {
            select: {
              blockchain: {
                select: {
                  name: true,
                  blockExplorer: true,
                },
              },
              contractAddress: true,
              name: true,
              symbol: true,
              decimals: true,
              logoUrl: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      this.prisma.transactionHistory.count({ where: baseWhere }),
    ]);

    // Purchase has no Prisma relation to TransactionHistory (hypertable).
    // Post-fetch associated purchases and attach them manually.
    const txIds = transactions.map((t) => t.id);
    const purchases = await this.prisma.purchase.findMany({
      where: { transactionId: { in: txIds } },
      include: {
        productVariant: {
          select: {
            name: true,
            product: {
              select: {
                id: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });
    const purchaseByTxId = new Map(purchases.map((p) => [p.transactionId, p]));

    const items = transactions.map((t) => ({
      ...t,
      purchase: purchaseByTxId.get(t.id) ?? null,
    }));

    return { items, total };
  }
}
