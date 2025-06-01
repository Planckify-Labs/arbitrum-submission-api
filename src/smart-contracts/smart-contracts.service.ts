import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSmartContractDto } from "./dto/create-smart-contract.dto";
import { UpdateSmartContractDto } from "./dto/update-smart-contract.dto";
import { SearchSmartContractDto } from "./dto/search-smart-contract.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class SmartContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSmartContractDto: CreateSmartContractDto) {
    return await this.prisma.smartContract.create({
      data: createSmartContractDto,
      include: {
        blockchain: true,
        abi: true,
      },
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return await this.prisma.smartContract.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        blockchain: true,
        abi: true,
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
      abiId,
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

    // Add blockchain-related filters
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

    if (abiId) {
      where.abiId = abiId;
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
        abi: true,
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
    const smartContract = await this.prisma.smartContract.findUnique({
      where: { id },
      include: {
        blockchain: true,
        abi: true,
      },
    });

    if (!smartContract) {
      throw new NotFoundException(`Smart contract with ID "${id}" not found`);
    }

    return smartContract;
  }

  async update(id: string, updateSmartContractDto: UpdateSmartContractDto) {
    try {
      return await this.prisma.smartContract.update({
        where: { id },
        data: updateSmartContractDto,
        include: {
          blockchain: true,
          abi: true,
        },
      });
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
}
