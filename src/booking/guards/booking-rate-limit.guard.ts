import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { RateLimitCacheService } from '../../valkey/services/rate-limit-cache.service';
import { getBookingConfig } from '../../config/app.config';

/**
 * Limits bookings per wallet address using Valkey atomic INCR.
 * Replaces the previous prisma.bookingOrder.count() DB query per request.
 */
@Injectable()
export class BookingRateLimitGuard implements CanActivate {
  private readonly rateLimitWindowMs: number;
  private readonly maxBookingsPerWindow: number;

  constructor(
    private readonly rateLimitCacheService: RateLimitCacheService,
    private readonly configService: ConfigService,
  ) {
    const bookingConfig = getBookingConfig(this.configService);
    this.rateLimitWindowMs = bookingConfig.rateLimitWindowMinutes * 60 * 1000;
    this.maxBookingsPerWindow = bookingConfig.rateLimitMaxRequests;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const walletAddress = request.body.walletAddress as string | undefined;

    if (!walletAddress) {
      throw new HttpException('Wallet address required', HttpStatus.BAD_REQUEST);
    }

    const { allowed } = await this.rateLimitCacheService.checkRateLimit(
      `booking:${walletAddress}`,
      this.maxBookingsPerWindow,
      this.rateLimitWindowMs,
    );

    if (!allowed) {
      const windowMinutes = this.rateLimitWindowMs / 60_000;
      throw new HttpException(
        `Rate limit exceeded. Maximum ${this.maxBookingsPerWindow} bookings per ${windowMinutes} minutes`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
