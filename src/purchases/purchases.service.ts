import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
import { Prisma } from "@generated/prisma";

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

    const product = await this.prisma.product.findUnique({
      where: { id: createPurchaseDto.productId },
    });

    if (!product) {
      throw new NotFoundException(
        `Product with ID ${createPurchaseDto.productId} not found`,
      );
    }

    const productPrice = await this.prisma.productPrice.findUnique({
      where: { id: createPurchaseDto.productPriceId },
    });

    if (!productPrice) {
      throw new NotFoundException(
        `Product price with ID ${createPurchaseDto.productPriceId} not found`,
      );
    }

    return this.prisma.purchase.create({
      data: createPurchaseDto,
      include: {
        transaction: true,
        product: true,
        productPrice: true,
        apiLogs: true,
      },
    });
  }

  async findAll() {
    return await this.prisma.purchase.findMany({
      include: {
        transaction: true,
        product: true,
        productPrice: true,
        apiLogs: true,
      },
    });
  }

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        transaction: true,
        product: true,
        productPrice: true,
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
        product: true,
        productPrice: true,
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

  async search(searchParams: SearchPurchaseDto) {
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
      where: {
        ...(transactionId && { transactionId }),
        ...(productId && { productId }),
        ...(status && { status }),
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
          product: {
            vendorId,
          },
        }),
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        product: {
          include: {
            vendor: true,
          },
        },
        productPrice: true,
        apiLogs: true,
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

    return this.prisma.purchase.findMany({
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
        product: {
          include: {
            vendor: true,
          },
        },
        productPrice: true,
        apiLogs: true,
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

    return this.prisma.purchase.findMany({
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
        product: {
          include: {
            vendor: true,
          },
        },
        productPrice: true,
        apiLogs: true,
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

    return this.prisma.purchase.findMany({
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
        product: {
          include: {
            vendor: true,
          },
        },
        productPrice: true,
        apiLogs: true,
      },
    });
  }
}
