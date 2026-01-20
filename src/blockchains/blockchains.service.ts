import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateBlockchainDto } from "./dto/create-blockchain.dto";
import { UpdateBlockchainDto } from "./dto/update-blockchain.dto";
import { SearchBlockchainDto } from "./dto/search-blockchain.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { BlockchainCacheService } from "../valkey/services/blockchain-cache.service";

@Injectable()
export class BlockchainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainCache: BlockchainCacheService,
  ) {}

  async create(createBlockchainDto: CreateBlockchainDto) {
    return await this.prisma.blockchain.create({
      data: createBlockchainDto,
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.blockchainCache.getAllBlockchains(cursor, () =>
      this.prisma.blockchain.findMany({
        take,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        include: {
          tokens: {
            where: {
              isNativeCurrency: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      }),
    );
  }

  async search(
    searchParams: SearchBlockchainDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const { name, chainId, isEVM, isActive, isTestnet } = searchParams;

    const where: Prisma.BlockchainWhereInput = {};

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    if (chainId) {
      where.chainId = chainId;
    }

    if (isEVM !== undefined) {
      where.isEVM = isEVM;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isTestnet !== undefined) {
      where.isTestnet = isTestnet;
    }

    return await this.prisma.blockchain.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      include: {
        tokens: {
          where: {
            isNativeCurrency: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });
  }

  async findOne(id: string) {
    const blockchain = await this.blockchainCache.getById(id, () =>
      this.prisma.blockchain.findUnique({
        where: { id },
        include: {
          tokens: {
            where: {
              isNativeCurrency: true,
            },
          },
        },
      }),
    );

    if (!blockchain) {
      throw new NotFoundException(`Blockchain with ID "${id}" not found`);
    }

    return blockchain;
  }

  async update(id: string, updateBlockchainDto: UpdateBlockchainDto) {
    try {
      const result = await this.prisma.blockchain.update({
        where: { id },
        data: updateBlockchainDto,
      });
      // Invalidate cache after update
      await this.blockchainCache.invalidateBlockchain(id);
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(`Blockchain with ID "${id}" not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.blockchain.delete({
        where: { id },
      });
      // Invalidate cache after delete
      await this.blockchainCache.invalidateBlockchain(id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(`Blockchain with ID "${id}" not found`);
      }
      throw error;
    }
  }
}
