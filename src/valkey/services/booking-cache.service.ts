import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Booking cache service
 * Uses short TTL cache for booking data (frequently changing status)
 *
 * Cache Keys:
 * - booking:{id} - Specific booking
 * - booking:ref:{refId} - Booking by reference ID
 * - user:{walletAddress}:bookings:latest - Latest booking for user
 * - user:{walletAddress}:bookings:pending - Pending bookings for user
 */
@Injectable()
export class BookingCacheService {
  private readonly logger = new Logger(BookingCacheService.name);
  private readonly TTL = {
    BOOKING_DETAILS: 300, // 5 minutes - bookings change status frequently
    USER_BOOKINGS: 180, // 3 minutes - user's booking list
    LATEST_BOOKING: 60, // 1 minute - latest booking (very dynamic)
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  /**
   * Get booking by ID
   */
  async getBooking<T>(
    bookingId: number | string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('booking', bookingId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.BOOKING_DETAILS,
    });
  }

  /**
   * Get booking by reference ID
   */
  async getBookingByRef<T>(
    refId: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('booking', 'ref', refId);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.BOOKING_DETAILS,
    });
  }

  /**
   * Get latest booking for user's wallet
   */
  async getLatestBooking<T>(
    walletAddress: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'user',
      walletAddress.toLowerCase(),
      'bookings',
      'latest',
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.LATEST_BOOKING,
    });
  }

  /**
   * Get pending bookings for user
   */
  async getPendingBookings<T>(
    walletAddress: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey(
      'user',
      walletAddress.toLowerCase(),
      'bookings',
      'pending',
    );
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.USER_BOOKINGS,
    });
  }

  /**
   * Invalidate booking cache
   * Call this when booking status changes (PENDING → EXECUTED, EXPIRED, CANCELLED)
   */
  async invalidateBooking(
    bookingId?: number | string,
    walletAddress?: string,
  ): Promise<void> {
    const patterns: string[] = [];

    if (bookingId) {
      patterns.push(`booking:${bookingId}*`);
    } else {
      patterns.push('booking:*');
    }

    if (walletAddress) {
      patterns.push(`user:${walletAddress.toLowerCase()}:bookings:*`);
    }

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(
      `Invalidated booking cache (ID: ${bookingId ?? 'all'}, Wallet: ${walletAddress ?? 'N/A'})`,
    );
  }

  /**
   * Invalidate user's booking caches
   */
  async invalidateUserBookings(walletAddress: string): Promise<void> {
    const pattern = this.cacheManager.buildPattern(
      `user:${walletAddress.toLowerCase()}:bookings:*`,
    );
    await this.cacheManager.invalidatePattern(pattern);
    this.logger.debug(`Invalidated bookings for wallet ${walletAddress}`);
  }

  /**
   * Write-through pattern: Update booking and cache together
   */
  async updateBooking<T>(
    bookingId: number | string,
    updater: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('booking', bookingId);

    return this.cacheManager.writeThrough(
      key,
      null as any, // Data comes from updater
      updater,
      this.TTL.BOOKING_DETAILS,
    );
  }

  /**
   * Set booking in cache (useful for write-through pattern after creation)
   */
  async setBooking<T>(booking: T & { id: number | string }): Promise<void> {
    const key = this.cacheManager.buildKey('booking', booking.id);
    await this.cacheManager.set(key, booking, this.TTL.BOOKING_DETAILS);
  }

  /**
   * Check if booking is cached (useful for quick checks without DB query)
   */
  async isBookingCached(bookingId: number | string): Promise<boolean> {
    const key = this.cacheManager.buildKey('booking', bookingId);
    return this.cacheManager.exists(key);
  }

  /**
   * Batch invalidate bookings (useful after bulk expiry job)
   */
  async batchInvalidateBookings(bookingIds: number[]): Promise<void> {
    const keys = bookingIds.map((id) =>
      this.cacheManager.buildKey('booking', id),
    );
    await this.cacheManager.invalidateKeys(keys);
    this.logger.debug(`Batch invalidated ${bookingIds.length} bookings`);
  }
}
