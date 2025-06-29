import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
import {
  Prisma,
  PurchaseStatus,
  TransactionType,
  TransactionStatus,
} from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { BookingStatus } from "../booking/enums/booking-status.enum";

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPurchaseDto: CreatePurchaseDto) {
    const { bookingId, walletAddress, networkId, contractAddress } =
      createPurchaseDto;

    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: networkId },
    });

    if (!blockchain) {
      throw new NotFoundException(`Network with ID ${networkId} not found`);
    }

    if (!blockchain.isActive) {
      throw new BadRequestException(`Network ${blockchain.name} is not active`);
    }

    const smartContract = await this.prisma.smartContract.findUnique({
      where: {
        blockchainId_address: {
          blockchainId: networkId,
          address: contractAddress,
        },
      },
    });

    if (!smartContract) {
      throw new BadRequestException(
        `Smart contract with address ${contractAddress} not found on network ${blockchain.name}`,
      );
    }

    if (!smartContract.isActive) {
      throw new BadRequestException(
        `Smart contract ${smartContract.name} is not active on network ${blockchain.name}`,
      );
    }

    const booking = await this.prisma.bookingOrder.findUnique({
      where: { id: bookingId },
      include: {
        productVariant: {
          include: {
            product: true,
          },
        },
        productPrice: {
          include: {
            vendor: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        `Booking is ${booking.status.toLowerCase()}, must be PENDING`,
      );
    }

    if (booking.expiresAt < new Date()) {
      throw new BadRequestException("Booking has expired");
    }

    if (booking.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new BadRequestException(
        `Wallet address mismatch: booking belongs to ${booking.walletAddress}`,
      );
    }

    const payment = booking.payment as {
      tokenAddress: string;
      blockchainNetworkId: string;
      amount: string;
    };

    if (payment.blockchainNetworkId !== networkId) {
      throw new BadRequestException(
        `Network ID mismatch: booking uses network ${payment.blockchainNetworkId}, but ${networkId} was provided`,
      );
    }

    let user = await this.prisma.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          walletAddress,
          authProvider: "WALLET",
        },
      });
    }

    const token = await this.prisma.token.findUnique({
      where: {
        blockchainId_contractAddress: {
          blockchainId: networkId,
          contractAddress: payment.tokenAddress,
        },
      },
    });

    if (!token) {
      throw new BadRequestException(
        `Token with address ${payment.tokenAddress} not found on network ${blockchain.name}`,
      );
    }

    const exchangeRateObj = booking.exchangeRate as { rate: number } | null;
    const exchangeRate = exchangeRateObj?.rate || 0;

    const sellPrice = booking.productPrice?.sellPrice?.toString() || "0";
    const amountInFiat =
      exchangeRate && sellPrice
        ? (Number(sellPrice) * exchangeRate).toString()
        : "0";

    const transaction = await this.prisma.transactionHistory.create({
      data: {
        user: {
          connect: { id: user.id },
        },
        token: {
          connect: { id: token.id },
        },
        amount: payment.amount,
        amountInFiat,
        fiatCurrency: "IDR",
        type: TransactionType.PAYMENT,
        status: TransactionStatus.PENDING,
        senderAddress: walletAddress,
        recipientAddress: smartContract.address,
      },
    });

    const purchaseData: Prisma.PurchaseCreateInput = {
      transaction: {
        connect: { id: transaction.id },
      },
      productVariant: {
        connect: { id: booking.productVariantId },
      },
      status: PurchaseStatus.PENDING,
    };

    const purchase = await this.prisma.purchase.create({
      data: purchaseData,
    });

    await this.prisma.bookingOrder.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.EXECUTED,
      },
    });
    return `${purchase.id}#${booking.id}#${booking.productVariantId}`;
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
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}
