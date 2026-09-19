import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import { BookingStatus } from "./enums/booking-status.enum";

/** Remind when the lock has between 1 and 2½ minutes left. */
const WINDOW_START_MS = 60_000;
const WINDOW_END_MS = 150_000;
const BATCH = 200;

/**
 * "Your price lock is about to expire" for bookings the user walked away
 * from. Runs every minute on every instance; the push's dedupe key
 * (`booking-expiring:<id>`) makes overlapping runs harmless, and the TTL
 * on the push means a late delivery is dropped rather than shown after
 * the booking is already gone. A booking that already has a purchase is
 * being paid for — no reminder.
 */
@Injectable()
export class BookingReminderService {
  private readonly logger = new Logger(BookingReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "booking-expiry-reminder" })
  async remind(): Promise<number> {
    const now = Date.now();
    const due = await this.prisma.bookingOrder.findMany({
      where: {
        status: BookingStatus.PENDING as BookingStatus,
        purchase: null,
        expiresAt: {
          gte: new Date(now + WINDOW_START_MS),
          lt: new Date(now + WINDOW_END_MS),
        },
      },
      select: {
        id: true,
        walletAddress: true,
        expiresAt: true,
        productVariant: { select: { product: { select: { name: true } } } },
      },
      orderBy: { expiresAt: "asc" },
      take: BATCH,
    });
    if (due.length === 0) return 0;

    let sent = 0;
    for (const booking of due) {
      try {
        const result = await this.pushService.sendBookingExpiringPush({
          walletAddress: booking.walletAddress,
          bookingId: booking.id,
          productName: booking.productVariant.product.name,
          expiresAt: booking.expiresAt,
        });
        if (!result.deduplicated) sent += 1;
      } catch (err) {
        this.logger.warn(
          `[booking-reminder] push failed for booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (sent > 0) {
      this.logger.log(`[booking-reminder] reminded ${sent}/${due.length}`);
    }
    return sent;
  }
}
