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
      },
      include: {
        token: true,
        purchase: true,
      },
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    // For hypertable with composite PK, use createdAt-based cursor pagination
    let cursorDate: Date | undefined;
    if (cursor) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      cursorDate = cursorTx?.createdAt;
    }

    return await this.prisma.transactionHistory.findMany({
      take,
      where: cursorDate ? { createdAt: { lt: cursorDate } } : undefined,
      include: {
        token: true,
        purchase: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
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
        purchase: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    return transaction;
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
        purchase: true,
      },
    });
  }

  async findByUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return await this.prisma.transactionHistory.findMany({
      where: { userId },
      include: {
        token: true,
        purchase: true,
      },
    });
  }

  async findByBlockchain(blockchainId: string) {
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: blockchainId },
    });

    if (!blockchain) {
      throw new NotFoundException(
        `Blockchain with ID ${blockchainId} not found`,
      );
    }

    return await this.prisma.transactionHistory.findMany({
      where: {
        token: {
          blockchainId,
        },
      },
      include: {
        token: true,
        purchase: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByToken(tokenId: string) {
    const token = await this.prisma.token.findUnique({
      where: { id: tokenId },
    });

    if (!token) {
      throw new NotFoundException(`Token with ID ${tokenId} not found`);
    }

    return await this.prisma.transactionHistory.findMany({
      where: { tokenId },
      include: {
        token: true,
        purchase: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
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

    return await this.prisma.transactionHistory.findMany({
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
        purchase: {
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
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async search(
    searchParams: SearchTransactionDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
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

    // For hypertable with composite PK, use createdAt-based cursor pagination
    if (cursor) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorTx) {
        where.createdAt = where.createdAt || {};
        (where.createdAt as Prisma.DateTimeFilter).lt = cursorTx.createdAt;
      }
    }

    return await this.prisma.transactionHistory.findMany({
      take,
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
        purchase: {
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
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}
