import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPurchaseDto: CreatePurchaseDto) {
    const transaction = await this.prisma.transactionHistory.findUnique({
      where: { id: createPurchaseDto.transactionId },
    });

    if (!transaction) {
      throw new NotFoundException(
        `Transaction with ID ${createPurchaseDto.transactionId} not found`,
      );
    }

    const productVariant = await this.prisma.productVariant.findUnique({
      where: { id: createPurchaseDto.productVariantId },
    });

    if (!productVariant) {
      throw new NotFoundException(
        `Product variant with ID ${createPurchaseDto.productVariantId} not found`,
      );
    }

    return this.prisma.purchase.create({
      data: createPurchaseDto,
      include: {
        transaction: true,
        productVariant: {
          include: {
            product: true,
          },
        },
        apiLogs: true,
      },
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return await this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        transaction: true,
        productVariant: {
          include: {
            product: true,
          },
        },
        apiLogs: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        transaction: true,
        productVariant: {
          include: {
            product: true,
          },
        },
        apiLogs: true,
      },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    return purchase;
  }

  async updateStatus(id: string, updatePurchaseDto: UpdatePurchaseDto) {
    await this.findOne(id);

    const updateData: Prisma.PurchaseUpdateInput = {
      status: updatePurchaseDto.status,
      vendorRefId: updatePurchaseDto.vendorRefId,
      ...(updatePurchaseDto.vendorResponse && {
        vendorResponse:
          updatePurchaseDto.vendorResponse as Prisma.InputJsonValue,
      }),
    };

    return await this.prisma.purchase.update({
      where: { id },
      data: updateData,
      include: {
        transaction: true,
        productVariant: {
          include: {
            product: true,
          },
        },
        apiLogs: true,
      },
    });
  }

  async getStatus(id: string) {
    const purchase = await this.findOne(id);
    return {
      id: purchase.id,
      status: purchase.status,
      vendorResponse: purchase.vendorResponse,
      vendorRefId: purchase.vendorRefId,
      updatedAt: purchase.updatedAt,
    };
  }

  async search(
    searchParams: SearchPurchaseDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const {
      userId,
      transactionId,
      productId,
      vendorId,
      tokenId,
      blockchainId,
      status,
    } = searchParams;

    return await this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        ...(transactionId && { transactionId }),
        ...(status && { status }),
        ...(productId && {
          productVariant: {
            product: {
              id: productId,
            },
          },
        }),
        ...(userId && {
          transaction: {
            userId,
          },
        }),
        ...(tokenId && {
          transaction: {
            tokenId,
          },
        }),
        ...(blockchainId && {
          transaction: {
            token: {
              blockchainId,
            },
          },
        }),
        ...(vendorId && {
          productVariant: {
            ProductPrice: {
              some: {
                vendor: {
                  id: vendorId,
                },
              },
            },
          },
        }),
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
        apiLogs: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByUser(userId: string, paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transaction: {
          userId,
        },
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
        apiLogs: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByToken(tokenId: string, paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    const token = await this.prisma.token.findUnique({
      where: { id: tokenId },
    });

    if (!token) {
      throw new NotFoundException(`Token with ID ${tokenId} not found`);
    }

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transaction: {
          tokenId,
        },
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
        apiLogs: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByBlockchain(
    blockchainId: string,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;

    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: blockchainId },
    });

    if (!blockchain) {
      throw new NotFoundException(
        `Blockchain with ID ${blockchainId} not found`,
      );
    }

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transaction: {
          token: {
            blockchainId,
          },
        },
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
        apiLogs: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}
