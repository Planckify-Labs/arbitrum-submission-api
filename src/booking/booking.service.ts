import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaClient } from "@generated/prisma";
import { CreateBookingDto } from "./dto/booking.dto";
import { ConfigService } from "@nestjs/config";
import {
  BookingPayment,
  BookingExchangeRate,
  WhereClause,
  DbBooking,
} from "./interfaces/booking.interface";
import { PrismaService } from "../prisma/prisma.service";
import { BookingQueryDto } from "./dto/booking-query.dto";
import { Decimal } from "@prisma/client/runtime/library";
import { BookingStatus } from "./enums/booking-status.enum";
import { BlockchainsService } from "../blockchains/blockchains.service";

@Injectable()
export class BookingService {
  private readonly prisma: PrismaClient;
  private readonly BOOKING_EXPIRY_MINUTES: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly blockchainsService: BlockchainsService,
  ) {
    this.prisma = new PrismaClient();
    this.BOOKING_EXPIRY_MINUTES = this.configService.get(
      "BOOKING_EXPIRY_MINUTES",
      15,
    );
  }

  async createBooking(createBookingDto: CreateBookingDto) {
    const { walletAddress, productVariantId, payment } = createBookingDto;

    const booking = await this.prisma.$transaction(async (tx) => {
      const blockchain = await this.blockchainsService.findOne(
        payment.blockchainId,
      );
      if (!blockchain) {
        throw new NotFoundException(
          `Blockchain network with ID ${payment.blockchainId} not found`,
        );
      }
      if (!blockchain.isActive) {
        throw new BadRequestException(
          `Blockchain network ${blockchain.name} is not active`,
        );
      }

      const token = await tx.token.findUnique({
        where: {
          blockchainId_contractAddress: {
            blockchainId: payment.blockchainId,
            contractAddress: payment.tokenAddress,
          },
        },
      });

      if (!token) {
        throw new BadRequestException(
          `Token with address ${payment.tokenAddress} not found on blockchain ${blockchain.name}`,
        );
      }

      if (!token.isActive) {
        throw new BadRequestException(
          `Token ${token.symbol} (${payment.tokenAddress}) is not active on blockchain ${blockchain.name}`,
        );
      }

      const productVariant = await tx.productVariant.findUnique({
        where: { id: productVariantId },
        include: {
          product: true,
          ProductPrice: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!productVariant) {
        throw new NotFoundException(
          `Product variant with ID ${productVariantId} not found`,
        );
      }

      if (!productVariant.ProductPrice.length) {
        throw new BadRequestException(
          `No active price found for product variant ${productVariantId}`,
        );
      }

      const productPrice = productVariant.ProductPrice[0];

      const exchangeRate = await tx.exchangeRate.findUnique({
        where: {
          id_createdAt: {
            id: payment.exchangeRateId,
            createdAt: new Date(),
          },
        },
      });

      if (!exchangeRate) {
        throw new BadRequestException(
          `Exchange rate with ID ${payment.exchangeRateId} not found`,
        );
      }

      if (!exchangeRate.isActive) {
        throw new BadRequestException(
          `Exchange rate with ID ${payment.exchangeRateId} is no longer active`,
        );
      }

      if (exchangeRate.fromCurrency !== token.symbol) {
        throw new BadRequestException(
          `Exchange rate ${payment.exchangeRateId} is for ${exchangeRate.fromCurrency}, but token is ${token.symbol}`,
        );
      }

      const sellPrice = new Decimal(productPrice.sellPrice.toString());
      const rate = new Decimal(exchangeRate.rate.toString());
      const tokenAmount = sellPrice.div(rate);

      const booking = await tx.bookingOrder.create({
        data: {
          walletAddress,
          productVariantId,
          productPriceId: productPrice.id,
          payment: {
            tokenAddress: payment.tokenAddress,
            blockchainNetworkId: blockchain.id,
            amount: tokenAmount.toString(),
          },
          exchangeRate: {
            id: exchangeRate.id,
            rate: Number(exchangeRate.rate),
            fromCurrency: token.symbol,
            toCurrency: exchangeRate.toCurrency,
            lockedAt: new Date().toISOString(),
          },
          status: "PENDING" as BookingStatus,
          expiresAt: new Date(
            Date.now() + this.BOOKING_EXPIRY_MINUTES * 60 * 1000,
          ),
        },
        include: {
          productVariant: {
            include: {
              product: true,
            },
          },
          productPrice: true,
        },
      });

      return this.formatBookingResponse(booking as unknown as DbBooking);
    });

    return booking;
  }

  async getLatestBooking(walletAddress: string) {
    const booking = await this.prisma.bookingOrder.findFirst({
      where: {
        walletAddress,
        status: BookingStatus.PENDING as BookingStatus,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        productVariant: {
          include: {
            product: true,
          },
        },
        productPrice: true,
      },
    });

    if (!booking) {
      return null;
    }

    return this.formatBookingResponse(booking as unknown as DbBooking);
  }

  async expireBookings() {
    await this.prisma.bookingOrder.updateMany({
      where: {
        status: BookingStatus.PENDING as BookingStatus,
        expiresAt: {
          lt: new Date(),
        },
      },
      data: {
        status: BookingStatus.EXPIRED as BookingStatus,
      },
    });
  }

  async markBookingExecuted(bookingId: string) {
    const booking = await this.prisma.bookingOrder.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        `Booking is ${booking.status.toLowerCase()}`,
      );
    }

    if (booking.expiresAt < new Date()) {
      throw new BadRequestException("Booking has expired");
    }

    return this.prisma.bookingOrder.update({
      where: { id: bookingId },
      data: {
        status: "EXECUTED" as BookingStatus,
      },
    });
  }

  async cancelBooking(bookingId: string) {
    const booking = await this.prisma.bookingOrder.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        `Booking is already ${booking.status.toLowerCase()}`,
      );
    }

    return this.prisma.bookingOrder.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED as BookingStatus,
      },
    });
  }

  async getBookings(walletAddress: string, query: BookingQueryDto) {
    const where: WhereClause = { walletAddress };

    if (query.status) {
      where.status = query.status as BookingStatus;
    }

    if (query.productId) {
      where.productVariantId = query.productId;
    }

    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom) {
        where.createdAt.gte = query.createdFrom;
      }
      if (query.createdTo) {
        where.createdAt.lte = query.createdTo;
      }
    }

    const bookings = await this.prisma.bookingOrder.findMany({
      where,
      include: {
        productVariant: {
          include: {
            product: true,
          },
        },
        productPrice: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return bookings.map((booking) =>
      this.formatBookingResponse(booking as unknown as DbBooking),
    );
  }

  async getBookingStats(walletAddress: string) {
    const [total, pending, executed, expired, cancelled, executionTimes] =
      await Promise.all([
        this.prisma.bookingOrder.count({
          where: { walletAddress },
        }),
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.PENDING as BookingStatus,
          },
        }),
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.EXECUTED as BookingStatus,
          },
        }),
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.EXPIRED as BookingStatus,
          },
        }),
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.CANCELLED as BookingStatus,
          },
        }),
        this.prisma.bookingOrder.findMany({
          where: {
            walletAddress,
            status: BookingStatus.EXECUTED as BookingStatus,
          },
          select: {
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);

    const avgTimeToExecution =
      executionTimes.length > 0
        ? executionTimes.reduce((acc, booking) => {
            const executionTime =
              booking.updatedAt.getTime() - booking.createdAt.getTime();
            return acc + executionTime / (1000 * 60);
          }, 0) / executionTimes.length
        : undefined;

    return {
      total,
      pending,
      executed,
      expired,
      cancelled,
      conversionRate: total > 0 ? executed / total : 0,
      expirationRate: total > 0 ? expired / total : 0,
      avgTimeToExecution,
    };
  }

  private async formatBookingResponse(booking: DbBooking) {
    const payment = booking.payment as unknown as BookingPayment;
    const exchangeRateInfo =
      booking.exchangeRate as unknown as BookingExchangeRate;

    const blockchain = await this.blockchainsService.findOne(
      payment.blockchainNetworkId,
    );

    const token = await this.prisma.token.findUnique({
      where: {
        blockchainId_contractAddress: {
          blockchainId: payment.blockchainNetworkId,
          contractAddress: payment.tokenAddress,
        },
      },
    });

    if (!token) {
      throw new NotFoundException(
        `Token with address ${payment.tokenAddress} not found on blockchain ${blockchain.name}`,
      );
    }

    return {
      id: booking.id,
      walletAddress: booking.walletAddress,
      product: {
        id: booking.productVariant.product.id,
        name: booking.productVariant.product.name,
        variant: {
          id: booking.productVariant.id,
          name: booking.productVariant.name,
          sku: booking.productVariant.sku,
        },
        price: {
          amount: Number(booking.productPrice.sellPrice),
          currency: exchangeRateInfo.toCurrency,
        },
      },
      payment: {
        token: {
          symbol: token.symbol,
          address: payment.tokenAddress,
          amount: payment.amount,
          blockchainId: blockchain.id,
          blockchainName: blockchain.name,
        },
        exchangeRate: {
          rate: exchangeRateInfo.rate,
          lockedAt: exchangeRateInfo.lockedAt,
        },
      },
      status: booking.status,
      expiresAt: booking.expiresAt.toISOString(),
      createdAt: booking.createdAt.toISOString(),
      executedAt:
        booking.status === BookingStatus.EXECUTED
          ? booking.updatedAt.toISOString()
          : undefined,
    };
  }
}
