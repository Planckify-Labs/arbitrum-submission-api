import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Sweeps expired QUOTED payment intents (task 29, spec §4.9).
 *
 * Runs every minute. Any `PaymentIntent` with `status = QUOTED` and
 * `expiresAt < now()` is flipped to `EXPIRED`. This handles the
 * "abandon-on-refresh" scenario where a user navigates away before
 * submitting a settlement — the quote's locked exchange rate must not
 * remain valid indefinitely.
 */
@Injectable()
export class IntentSweeperService {
  private readonly logger = new Logger(IntentSweeperService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepExpiredQuotes(): Promise<void> {
    const result = await this.prisma.paymentIntent.updateMany({
      where: {
        status: "QUOTED",
        expiresAt: { lt: new Date() },
      },
      data: { status: "EXPIRED" },
    });
    if (result.count > 0) {
      this.logger.log(`Swept ${result.count} expired QUOTED intents`);
    }
  }
}
