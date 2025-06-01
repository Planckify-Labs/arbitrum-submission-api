import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { UpdateTransactionDto } from "./dto/update-transaction.dto";
import { SearchTransactionDto } from "./dto/search-transaction.dto";
import { Prisma } from "@generated/prisma";

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createTransactionDto: CreateTransactionDto) {
    return await this.prisma.transactionHistory.create({
      data: createTransactionDto,
      include: {
        token: true,
        purchase: true,
      },
    });
  }

  async findAll() {
    return await this.prisma.transactionHistory.findMany({
      include: {
        token: true,
        purchase: true,
      },
    });
  }

  async findOne(id: string) {
    const transaction = await this.prisma.transactionHistory.findUnique({
      where: { id },
      include: {
        token: true,
        purchase: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    return transaction;
  }

  async updateStatus(id: string, updateTransactionDto: UpdateTransactionDto) {
    await this.findOne(id);

    return await this.prisma.transactionHistory.update({
      where: { id },
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

  async search(searchParams: SearchTransactionDto) {
    const {
      type,
      status,
      userId,
      tokenId,
      fromAddress,
      toAddress,
      startDate,
      endDate,
    } = searchParams;

    const where: Prisma.TransactionHistoryWhereInput = {};

    if (type) where.type = type;
    if (status) where.status = status;
    if (userId) where.userId = userId;
    if (tokenId) where.tokenId = tokenId;
    if (fromAddress) where.fromAddress = fromAddress;
    if (toAddress) where.toAddress = toAddress;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    return await this.prisma.transactionHistory.findMany({
      where,
      include: {
        token: true,
        purchase: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}
