import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class BookingRateLimitGuard implements CanActivate {
  private readonly MAX_PENDING_BOOKINGS = 3;
  private readonly RATE_LIMIT_WINDOW_MINUTES = 15;
  private readonly MAX_BOOKINGS_PER_WINDOW = 10;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const walletAddress = request.body.walletAddress;

    if (!walletAddress) {
      throw new HttpException(
        "Wallet address required",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check pending bookings count
    const pendingBookings = await this.prisma.bookingOrder.count({
      where: {
        walletAddress,
        status: "PENDING",
      },
    });

    if (pendingBookings >= this.MAX_PENDING_BOOKINGS) {
      throw new HttpException(
        `Maximum ${this.MAX_PENDING_BOOKINGS} pending bookings allowed`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Check rate limit within time window
    const windowStart = new Date(
      Date.now() - this.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    );

    const recentBookings = await this.prisma.bookingOrder.count({
      where: {
        walletAddress,
        createdAt: {
          gte: windowStart,
        },
      },
    });

    if (recentBookings >= this.MAX_BOOKINGS_PER_WINDOW) {
      throw new HttpException(
        `Rate limit exceeded. Maximum ${this.MAX_BOOKINGS_PER_WINDOW} bookings per ${this.RATE_LIMIT_WINDOW_MINUTES} minutes`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
