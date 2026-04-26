import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSmartContractDto } from "./dto/create-smart-contract.dto";
import { UpdateSmartContractDto } from "./dto/update-smart-contract.dto";
import { SearchSmartContractDto } from "./dto/search-smart-contract.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { SmartContractCacheService } from "../valkey/services/smart-contract-cache.service";

@Injectable()
export class SmartContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contractCache: SmartContractCacheService,
  ) {}

  async create(createSmartContractDto: CreateSmartContractDto) {
    return await this.prisma.smartContract.create({
      data: createSmartContractDto,
      include: {
        blockchain: true,
      },
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.contractCache.getAllContracts(cursor, () =>
      this.prisma.smartContract.findMany({
        take,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        include: {
          blockchain: true,
        },
        orderBy: [
          {
            blockchain: {
              name: "asc",
            },
          },
          {
            name: "asc",
          },
        ],
      }),
    );
  }

  async search(
    searchParams: SearchSmartContractDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const {
      name,
      blockchainId,
      blockchainName,
      chainId,
      isBlockchainEVM,
      address,
      isActive,
    } = searchParams;

    const where: Prisma.SmartContractWhereInput = {};

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    if (blockchainId) {
      where.blockchainId = blockchainId;
    }

    const blockchainWhere: Prisma.BlockchainWhereInput = {};
    let hasBlockchainFilters = false;

    if (blockchainName) {
      blockchainWhere.name = {
        contains: blockchainName,
        mode: "insensitive",
      };
      hasBlockchainFilters = true;
    }

    if (chainId) {
      blockchainWhere.chainId = chainId;
      hasBlockchainFilters = true;
    }

    if (isBlockchainEVM !== undefined) {
      blockchainWhere.isEVM = isBlockchainEVM;
      hasBlockchainFilters = true;
    }

    if (hasBlockchainFilters) {
      where.blockchain = blockchainWhere;
    }

    if (address) {
      where.address = address;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    return await this.prisma.smartContract.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      include: {
        blockchain: true,
      },
      orderBy: [
        {
          blockchain: {
            name: "asc",
          },
        },
        {
          name: "asc",
        },
      ],
    });
  }

  async findOne(id: string) {
    const smartContract = await this.contractCache.getById(id, () =>
      this.prisma.smartContract.findUnique({
        where: { id },
        include: {
          blockchain: true,
        },
      }),
    );

    if (!smartContract) {
      throw new NotFoundException(`Smart contract with ID "${id}" not found`);
    }

    return smartContract;
  }

  async findByChainId(chainId: number) {
    const smartContract = await this.contractCache.getByChainId(chainId, () =>
      this.prisma.smartContract.findFirst({
        where: {
          blockchain: {
            chainId: chainId,
          },
          isActive: true,
        },
        include: {
          blockchain: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    );

    if (!smartContract) {
      throw new NotFoundException(`Active smart contract for chain ID "${chainId}" not found`);
    }

    return smartContract;
  }

  async update(id: string, updateSmartContractDto: UpdateSmartContractDto) {
    try {
      const result = await this.prisma.smartContract.update({
        where: { id },
        data: updateSmartContractDto,
        include: {
          blockchain: true,
        },
      });
      await this.contractCache.invalidateContract(id);
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(`Smart contract with ID "${id}" not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.smartContract.delete({
        where: { id },
      });
      await this.contractCache.invalidateContract(id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(`Smart contract with ID "${id}" not found`);
      }
      throw error;
    }
  }

  async findByBlockchainAndAddress(blockchainId: string, address: string) {
    return this.contractCache.getByBlockchainAndAddress(
      blockchainId,
      address,
      () =>
        this.prisma.smartContract.findFirst({
          where: {
            blockchainId,
            address: { equals: address, mode: "insensitive" },
          },
          include: {
            blockchain: true,
          },
        }),
    );
  }
}
