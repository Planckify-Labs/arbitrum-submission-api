import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { FulfilmentStatus } from "@generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { FulfilmentService, POST_REFUND_WATCH_MS } from "./fulfilment.service";
import { FulfilmentKind } from "./fulfilment.types";

/** A SUBMITTED/DELAYED order nobody has asked the vendor about in this long lost its job. */
const STALE_CHECK_MS = 30 * 60 * 1000;
/** Don't hammer the vendor about orders from before the fulfilment leg existed. */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 100;

/**
 * Safety net under the delayed-job chain: Valkey restarts, a deploy
 * mid-backoff, or a job that threw past its retries all leave an order
 * with nobody polling it. Every 10 minutes, any open order that has not
 * been checked recently gets one check (which re-arms its own chain).
 * Refunded orders inside the clawback window are included so a late
 * delivery is noticed.
 */
@Injectable()
export class FulfilmentSweeperService {
  private readonly logger = new Logger(FulfilmentSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfilment: FulfilmentService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: "fulfilment-sweeper" })
  async sweep(): Promise<number> {
    const staleBefore = new Date(Date.now() - STALE_CHECK_MS);
    const since = new Date(Date.now() - LOOKBACK_MS);
    const refundWatchSince = new Date(Date.now() - POST_REFUND_WATCH_MS);

    const openWhere = {
      vendorRefId: { not: null },
      OR: [
        {
          fulfilmentStatus: {
            in: [FulfilmentStatus.SUBMITTED, FulfilmentStatus.DELAYED],
          },
          createdAt: { gte: since },
        },
        {
          fulfilmentStatus: FulfilmentStatus.REFUNDED,
          createdAt: { gte: refundWatchSince },
        },
      ],
      AND: [
        {
          OR: [
            { vendorLastCheckedAt: null },
            { vendorLastCheckedAt: { lt: staleBefore } },
          ],
        },
      ],
    };

    const [purchases, redemptions] = await Promise.all([
      this.prisma.purchase.findMany({
        where: openWhere,
        select: { id: true },
        orderBy: { updatedAt: "asc" },
        take: BATCH,
      }),
      this.prisma.pointRedemption.findMany({
        where: openWhere,
        select: { id: true },
        orderBy: { updatedAt: "asc" },
        take: BATCH,
      }),
    ]);

    const targets: Array<{ kind: FulfilmentKind; id: string }> = [
      ...purchases.map((p) => ({ kind: "purchase" as const, id: p.id })),
      ...redemptions.map((r) => ({ kind: "redemption" as const, id: r.id })),
    ];
    if (targets.length === 0) return 0;

    let checked = 0;
    for (const t of targets) {
      try {
        // attempt index past the tight part of the schedule: the sweeper
        // re-arms an hourly chain, not a 15-second one.
        await this.fulfilment.check(t.kind, t.id, {
          attempt: 8,
          reschedule: true,
        });
        checked++;
      } catch (err) {
        this.logger.warn(
          `[fulfilment-sweeper] ${t.kind} ${t.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(
      `[fulfilment-sweeper] checked ${checked}/${targets.length} stale orders`,
    );
    return checked;
  }
}
