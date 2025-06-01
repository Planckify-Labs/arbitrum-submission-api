import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTokenDto } from "./dto/create-token.dto";
import { UpdateTokenDto } from "./dto/update-token.dto";
import { SearchTokenDto } from "./dto/search-token.dto";
import { Prisma } from "@generated/prisma";

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createTokenDto: CreateTokenDto) {
    // Check if blockchain exists
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: createTokenDto.blockchainId },
    });

    if (!blockchain) {
      throw new NotFoundException(
        `Blockchain with ID ${createTokenDto.blockchainId} not found`,
      );
    }

    // Check for unique constraints
    if (createTokenDto.contractAddress) {
      const existingToken = await this.prisma.token.findUnique({
        where: {
          blockchainId_contractAddress: {
            blockchainId: createTokenDto.blockchainId,
            contractAddress: createTokenDto.contractAddress,
          },
        },
      });

      if (existingToken) {
        throw new Error(
          `Token with contract address ${createTokenDto.contractAddress} already exists on blockchain ${createTokenDto.blockchainId}`,
        );
      }
    }

    const existingSymbol = await this.prisma.token.findUnique({
      where: {
        blockchainId_symbol: {
          blockchainId: createTokenDto.blockchainId,
          symbol: createTokenDto.symbol,
        },
      },
    });

    if (existingSymbol) {
      throw new Error(
        `Token with symbol ${createTokenDto.symbol} already exists on blockchain ${createTokenDto.blockchainId}`,
      );
    }

    return this.prisma.token.create({
      data: createTokenDto,
      include: {
        blockchain: true,
        regionAvailability: true,
      },
    });
  }

  async findAll() {
    return await this.prisma.token.findMany({
      include: {
        blockchain: true,
        regionAvailability: true,
      },
    });
  }

  async findOne(id: string) {
    const token = await this.prisma.token.findUnique({
      where: { id },
      include: {
        blockchain: true,
        regionAvailability: true,
      },
    });

    if (!token) {
      throw new NotFoundException(`Token with ID ${id} not found`);
    }

    return token;
  }

  async update(id: string, updateTokenDto: UpdateTokenDto) {
    await this.findOne(id); // Check if token exists

    if (updateTokenDto.blockchainId) {
      const blockchain = await this.prisma.blockchain.findUnique({
        where: { id: updateTokenDto.blockchainId },
      });

      if (!blockchain) {
        throw new NotFoundException(
          `Blockchain with ID ${updateTokenDto.blockchainId} not found`,
        );
      }
    }

    // Check for unique constraints if updating relevant fields
    if (
      updateTokenDto.contractAddress ||
      updateTokenDto.symbol ||
      updateTokenDto.blockchainId
    ) {
      const token = await this.findOne(id);
      const blockchainId = updateTokenDto.blockchainId || token.blockchainId;

      if (updateTokenDto.contractAddress) {
        const existingToken = await this.prisma.token.findFirst({
          where: {
            AND: [
              { id: { not: id } },
              { blockchainId },
              { contractAddress: updateTokenDto.contractAddress },
            ],
          },
        });

        if (existingToken) {
          throw new Error(
            `Token with contract address ${updateTokenDto.contractAddress} already exists on blockchain ${blockchainId}`,
          );
        }
      }

      if (updateTokenDto.symbol) {
        const existingSymbol = await this.prisma.token.findFirst({
          where: {
            AND: [
              { id: { not: id } },
              { blockchainId },
              { symbol: updateTokenDto.symbol },
            ],
          },
        });

        if (existingSymbol) {
          throw new Error(
            `Token with symbol ${updateTokenDto.symbol} already exists on blockchain ${blockchainId}`,
          );
        }
      }
    }

    return this.prisma.token.update({
      where: { id },
      data: updateTokenDto,
      include: {
        blockchain: true,
        regionAvailability: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if token exists

    await this.prisma.token.delete({
      where: { id },
    });
  }

  async search(searchParams: SearchTokenDto) {
    const {
      symbol,
      name,
      blockchainId,
      contractAddress,
      isStablecoin,
      isActive,
    } = searchParams;

    // Build where clause based on provided filters
    const where: Prisma.TokenWhereInput = {};

    if (symbol) {
      where.symbol = { contains: symbol, mode: "insensitive" };
    }

    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }

    if (blockchainId) {
      where.blockchainId = blockchainId;
    }

    if (contractAddress) {
      where.contractAddress = {
        contains: contractAddress,
        mode: "insensitive",
      };
    }

    if (typeof isStablecoin !== "undefined") {
      where.isStablecoin = isStablecoin;
    }

    if (typeof isActive !== "undefined") {
      where.isActive = isActive;
    }

    return await this.prisma.token.findMany({
      where,
      include: {
        blockchain: true,
        regionAvailability: true,
      },
      orderBy: {
        symbol: "asc",
      },
    });
  }
}
