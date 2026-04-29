import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTokenDto } from "./dto/create-token.dto";
import { UpdateTokenDto } from "./dto/update-token.dto";
import { SearchTokenDto } from "./dto/search-token.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { TokenCacheService } from "../valkey/services/token-cache.service";

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCache: TokenCacheService,
  ) {}

  async create(createTokenDto: CreateTokenDto) {
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: createTokenDto.blockchainId },
    });

    if (!blockchain) {
      throw new NotFoundException(
        `Blockchain with ID ${createTokenDto.blockchainId} not found`,
      );
    }

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

    const { contractAddress, ...rest } = createTokenDto;

    const result = await this.prisma.token.create({
      data: {
        ...rest,
        ...(typeof contractAddress !== "undefined"
          ? { contractAddress }
          : {}),
      },
      include: {
        blockchain: true,
        regionAvailability: true,
      },
    });
    await this.tokenCache.invalidateToken();
    return result;
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;
    const cacheKey = `${cursor ?? "first"}:t${take}:s${skip ?? 0}`;

    return this.tokenCache.getAllTokens(
      cacheKey,
      async () => {
        const findArgs = {
          take,
          skip: useSkip ? skip : cursor ? 1 : 0,
          cursor: useSkip ? undefined : cursor ? { id: cursor } : undefined,
        };

        const [items, total] = await Promise.all([
          this.prisma.token.findMany({
            ...findArgs,
            include: {
              blockchain: true,
              regionAvailability: true,
            },
            orderBy: {
              symbol: "asc",
            },
          }),
          this.prisma.token.count(),
        ]);

        return { items, total };
      },
      take,
    );
  }

  async findOne(id: string) {
    const token = await this.tokenCache.getById(id, () =>
      this.prisma.token.findUnique({
        where: { id },
        include: {
          blockchain: true,
          regionAvailability: true,
        },
      }),
    );

    if (!token) {
      throw new NotFoundException(`Token with ID ${id} not found`);
    }

    return token;
  }

  async update(id: string, updateTokenDto: UpdateTokenDto) {
    await this.findOne(id);

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

    const result = await this.prisma.token.update({
      where: { id },
      data: updateTokenDto,
      include: {
        blockchain: true,
        regionAvailability: true,
      },
    });
    // Invalidate cache after update
    await this.tokenCache.invalidateToken(id);
    return result;
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.token.delete({
      where: { id },
    });
    // Invalidate cache after delete
    await this.tokenCache.invalidateToken(id);
  }

  async search(
    searchParams: SearchTokenDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;
    const {
      symbol,
      name,
      blockchainId,
      contractAddress,
      isStablecoin,
      isActive,
      isNativeCurrency,
      isPaymentEnabled,
    } = searchParams;

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

    if (typeof isNativeCurrency !== "undefined") {
      where.isNativeCurrency = isNativeCurrency;
    }

    if (typeof isPaymentEnabled !== "undefined") {
      where.isPaymentEnabled = isPaymentEnabled;
    }

    const findArgs = {
      take,
      skip: useSkip ? skip : cursor ? 1 : 0,
      cursor: useSkip ? undefined : cursor ? { id: cursor } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.token.findMany({
        ...findArgs,
        where,
        include: {
          blockchain: true,
          regionAvailability: true,
        },
        orderBy: {
          symbol: "asc",
        },
      }),
      this.prisma.token.count({ where }),
    ]);

    return { items, total };
  }
}
