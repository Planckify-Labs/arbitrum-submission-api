import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PushService } from "./push.service";

/**
 * Re-enqueues push outbox rows the queue lost track of (see
 * `PushService.sweepOutbox` for the three shapes of stuck row). Cheap when
 * nothing is stuck: one indexed query on (deliveryStatus, updatedAt).
 *
 * Runs on every API instance; that's fine — the dispatch worker's status
 * CAS means the extra jobs are no-ops, not duplicate pushes.
 */
@Injectable()
export class PushOutboxSweeper {
  private readonly logger = new Logger(PushOutboxSweeper.name);
  private running = false;

  constructor(private readonly pushService: PushService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "push-outbox-sweeper" })
  async sweep(): Promise<void> {
    if (this.running) return; // a slow Redis must not stack sweeps
    this.running = true;
    try {
      await this.pushService.sweepOutbox();
    } catch (err) {
      this.logger.warn(
        `sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
