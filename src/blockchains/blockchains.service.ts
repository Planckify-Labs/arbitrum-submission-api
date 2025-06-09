import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateBlockchainDto } from "./dto/create-blockchain.dto";
import { UpdateBlockchainDto } from "./dto/update-blockchain.dto";
import { SearchBlockchainDto } from "./dto/search-blockchain.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class BlockchainsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createBlockchainDto: CreateBlockchainDto) {
    return await this.prisma.blockchain.create({
      data: createBlockchainDto,
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return await this.prisma.blockchain.findMany({
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
    });
  }

  async search(
    searchParams: SearchBlockchainDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const { name, chainId, isEVM, isActive } = searchParams;

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
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id },
      include: {
        tokens: {
          where: {
            isNativeCurrency: true,
          },
        },
      },
    });

    if (!blockchain) {
      throw new NotFoundException(`Blockchain with ID "${id}" not found`);
    }

    return blockchain;
  }

  async update(id: string, updateBlockchainDto: UpdateBlockchainDto) {
    try {
      return await this.prisma.blockchain.update({
        where: { id },
        data: updateBlockchainDto,
      });
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
