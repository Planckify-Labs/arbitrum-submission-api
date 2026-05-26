import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";

const EVENT_APPROACHING = "defi.goal.approaching";
const EVENT_REACHED = "defi.goal.reached";

/**
 * Goal-deadline-watcher (spec §18).
 *
 * Daily cron. For each active position with `targetDate` not null:
 *   - if `targetDate - now ≤ 7 days` and we haven't emitted
 *     `defi.goal.approaching` for that position yet → emit it and
 *     write a marker row in `StrategyPositionEvent`.
 *   - if `targetDate ≤ now` and we haven't emitted `defi.goal.reached`
 *     for that position yet → emit it and write a marker row.
 *
 * The marker rows (`StrategyPositionEvent`) prevent dup notifications
 * even if the cron fires multiple times in a single day.
 */
@Processor("goal-deadline-watcher")
export class GoalDeadlineWatcherProcessor extends WorkerHost {
  private readonly logger = new Logger(GoalDeadlineWatcherProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.logger.log("Checking strategy positions for goal deadlines...");

    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.strategyPosition.findMany({
      where: {
        status: "active",
        targetDate: { not: null, lte: sevenDaysOut },
      },
    });

    let approachingEmitted = 0;
    let reachedEmitted = 0;

    for (const position of candidates) {
      if (!position.targetDate) continue;
      const reached = position.targetDate <= now;

      if (reached) {
        const ok = await this.tryRecordEvent(position.id, EVENT_REACHED);
        if (ok) {
          reachedEmitted++;
          this.logger.warn(
            `[goal-deadline] reached: position=${position.id} goal="${position.goal ?? ""}"`,
          );
          // Push-notification dispatch hook: emit on the NATS event
          // bus / push service. Left as a TODO marker — the worker
          // already guarantees once-per-position semantics via the
          // marker row, so the push integration can plug in without
          // reworking dedup.
        }
      } else {
        const ok = await this.tryRecordEvent(position.id, EVENT_APPROACHING);
        if (ok) {
          approachingEmitted++;
          this.logger.log(
            `[goal-deadline] approaching: position=${position.id} goal="${position.goal ?? ""}" target=${position.targetDate.toISOString()}`,
          );
        }
      }
    }

    this.logger.log(
      `[goal-deadline] scan complete. positions=${candidates.length} approaching_emitted=${approachingEmitted} reached_emitted=${reachedEmitted}`,
    );
  }

  /**
   * Atomically claim the (positionId, kind) marker. Returns `true`
   * when this call wrote the row; `false` when it already existed
   * (i.e. another invocation already emitted this event).
   */
  private async tryRecordEvent(positionId: string, kind: string): Promise<boolean> {
    try {
      await this.prisma.strategyPositionEvent.create({
        data: { positionId, kind },
      });
      return true;
    } catch (err) {
      // Unique constraint on (positionId, kind) — duplicate insertion
      // is the expected idempotency path. Anything else is a real
      // error and we surface it via the worker's normal failure
      // pipeline.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Unique") || message.includes("P2002")) {
        return false;
      }
      throw err;
    }
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Goal deadline watcher job ${job.id} completed`);
  }
}
