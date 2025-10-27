import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request } from "express";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { getBookingConfig } from "../../config/app.config";

@Injectable()
export class BookingRateLimitGuard implements CanActivate {
  private readonly rateLimitWindowMinutes: number;
  private readonly maxBookingsPerWindow: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const bookingConfig = getBookingConfig(this.configService);
    this.rateLimitWindowMinutes = bookingConfig.rateLimitWindowMinutes;
    this.maxBookingsPerWindow = bookingConfig.rateLimitMaxRequests;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const walletAddress = request.body.walletAddress;

    if (!walletAddress) {
      throw new HttpException(
        "Wallet address required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const windowStart = new Date(
      Date.now() - this.rateLimitWindowMinutes * 60 * 1000,
    );

    const recentBookings = await this.prisma.bookingOrder.count({
      where: {
        walletAddress,
        createdAt: {
          gte: windowStart,
        },
      },
    });

    if (recentBookings >= this.maxBookingsPerWindow) {
      throw new HttpException(
        `Rate limit exceeded. Maximum ${this.maxBookingsPerWindow} bookings per ${this.rateLimitWindowMinutes} minutes`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
