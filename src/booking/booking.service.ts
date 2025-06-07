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
  BookingWithRelations,
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
    const { walletAddress, productId, productPriceId, payment } =
      createBookingDto;

    const blockchain = await this.blockchainsService.findOne(
      payment.blockchainId,
    );

    if (!blockchain.isActive) {
      throw new BadRequestException(
        `Blockchain network ${blockchain.name} is not active`,
      );
    }

    const token = await this.prisma.token.findUnique({
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

    // 1. Validate product and price exist
    const productPrice = await this.prisma.productPrice.findUnique({
      where: { id: productPriceId },
      include: {
        product: true,
      },
    });

    if (
      !productPrice ||
      !productPrice.product ||
      productPrice.productId !== productId
    ) {
      throw new NotFoundException("Product or price not found");
    }

    // 2. Get current exchange rate
    const exchangeRate = await this.prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: token.symbol,
        toCurrency: "IDR", // You can make this dynamic based on region
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (!exchangeRate) {
      throw new BadRequestException(
        "Exchange rate not available for the selected token",
      );
    }

    // 3. Calculate token amount needed
    const sellPrice = new Decimal(productPrice.sellPrice.toString());
    const rate = new Decimal(exchangeRate.rate.toString());
    const tokenAmount = sellPrice.div(rate);

    // 4. Create booking with expiration
    const booking = await this.prisma.bookingOrder.create({
      data: {
        walletAddress,
        productId,
        productPriceId,
        payment: {
          tokenAddress: payment.tokenAddress,
          blockchainNetworkId: blockchain.id,
          amount: tokenAmount.toString(),
        },
        exchangeRate: {
          rate: Number(exchangeRate.rate),
          fromCurrency: token.symbol,
          toCurrency: exchangeRate.toCurrency,
          lockedAt: new Date().toISOString(),
        },
        status: BookingStatus.PENDING as BookingStatus,
        expiresAt: new Date(
          Date.now() + this.BOOKING_EXPIRY_MINUTES * 60 * 1000,
        ),
      },
      include: {
        product: true,
        productPrice: true,
      },
    });

    return this.formatBookingResponse(booking as DbBooking);
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
        product: true,
        productPrice: true,
      },
    });

    if (!booking) {
      return null;
    }

    return this.formatBookingResponse(booking as DbBooking);
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

  async markBookingExecuted(bookingId: string, purchaseId: string) {
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
        status: BookingStatus.EXECUTED as BookingStatus,
        purchaseId,
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
      where.productId = query.productId;
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
        product: true,
        productPrice: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return bookings.map((booking) =>
      this.formatBookingResponse(booking as DbBooking),
    );
  }

  async getBookingStats(walletAddress: string) {
    const [total, pending, executed, expired, cancelled, executionTimes] =
      await Promise.all([
        // Total bookings
        this.prisma.bookingOrder.count({
          where: { walletAddress },
        }),
        // Pending bookings
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.PENDING as BookingStatus,
          },
        }),
        // Executed bookings
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.EXECUTED as BookingStatus,
          },
        }),
        // Expired bookings
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.EXPIRED as BookingStatus,
          },
        }),
        // Cancelled bookings
        this.prisma.bookingOrder.count({
          where: {
            walletAddress,
            status: BookingStatus.CANCELLED as BookingStatus,
          },
        }),
        // Get execution times for executed bookings
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

    // Calculate average execution time
    const avgTimeToExecution =
      executionTimes.length > 0
        ? executionTimes.reduce((acc, booking) => {
            const executionTime =
              booking.updatedAt.getTime() - booking.createdAt.getTime();
            return acc + executionTime / (1000 * 60); // Convert to minutes
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

    // Fetch token details from database
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
        id: booking.product.id,
        name: booking.product.name,
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
