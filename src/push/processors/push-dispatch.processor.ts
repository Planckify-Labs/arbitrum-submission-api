import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import {
  PUSH_DISPATCH_QUEUE,
  type PushDispatchJobData,
  PushService,
} from "../push.service";

/**
 * Drains the push outbox: one job per `NotificationLog` row, keyed by its
 * id. The worker sends to the row's still-pending devices and throws when
 * some remain, which is what makes BullMQ schedule the next attempt on
 * the queue's exponential backoff (see `PushModule` for the budget).
 *
 * Idempotent by construction — `attemptDelivery` claims the row with a
 * status compare-and-set, so a stalled-job re-run, a sweeper re-enqueue
 * or the inline fallback in `enqueue` can never double-send a device.
 */
@Processor(PUSH_DISPATCH_QUEUE, { concurrency: 10 })
export class PushDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(PushDispatchProcessor.name);

  constructor(private readonly pushService: PushService) {
    super();
  }

  async process(job: Job<PushDispatchJobData>): Promise<void> {
    await this.pushService.processDispatch(job);
    this.logger.debug(
      `Dispatched push ${job.data.notificationLogId} (job ${job.id})`,
    );
  }
}
