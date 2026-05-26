import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Queue } from "bullmq";

/**
 * StrategiesScheduler — periodically (and on boot) enqueues
 * `defillama-poll` jobs so the `OpportunityCache` stays warm.
 *
 * Boot path: `onApplicationBootstrap` fires a single poll so a fresh
 * dev server has data within ~30s without waiting for the cron tick.
 *
 * Cron path: `@Cron(CronExpression.EVERY_30_MINUTES)` keeps the cache
 * within the freshness window the `score-opportunities` worker assumes.
 *
 * Gated by `DEFI_WORKERS_ENABLED` (true by default) so a CI / local
 * environment without Valkey reachable can opt out cleanly.
 */
@Injectable()
export class StrategiesScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(StrategiesScheduler.name);
  private readonly enabled: boolean;

  constructor(
    @InjectQueue("defillama-poll") private readonly pollQueue: Queue,
    @InjectQueue("auto-compound-watcher")
    private readonly autoCompoundQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.enabled =
      this.configService.get<string>("DEFI_WORKERS_ENABLED", "true") !==
      "false";
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log(
        "DEFI_WORKERS_ENABLED=false — skipping defillama-poll bootstrap enqueue",
      );
      return;
    }
    try {
      await this.pollQueue.add(
        "poll-defillama",
        { reason: "bootstrap" },
        {
          jobId: `poll-bootstrap-${Date.now()}`,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      this.logger.log("Enqueued defillama-poll on application bootstrap");
    } catch (err) {
      this.logger.error(
        `Failed to enqueue defillama-poll on bootstrap: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES, { name: "defillama-poll-cron" })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.pollQueue.add(
        "poll-defillama",
        { reason: "cron" },
        {
          jobId: `poll-cron-${Date.now()}`,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      this.logger.log("Enqueued defillama-poll (30-min cron tick)");
    } catch (err) {
      this.logger.error(
        `defillama-poll cron enqueue failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Auto-compound nudges run once a day. The worker's own
   * (positionId, kind=`auto_compound_nudge:<bucket>`) dedup makes
   * sure each user only sees one nudge per configured window
   * (default 7 days) even though the cron fires daily.
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM, { name: "auto-compound-watcher-cron" })
  async tickAutoCompound(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.autoCompoundQueue.add(
        "scan",
        { reason: "cron" },
        {
          jobId: `auto-compound-cron-${Date.now()}`,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      this.logger.log("Enqueued auto-compound-watcher (daily cron tick)");
    } catch (err) {
      this.logger.error(
        `auto-compound-watcher cron enqueue failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
