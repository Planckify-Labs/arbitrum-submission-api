import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { FulfilmentService } from "./fulfilment.service";
import { FULFILMENT_QUEUE, FulfilmentCheckJob } from "./fulfilment.types";

/**
 * One vendor status check per job. "Still pending" is not a failure —
 * the service enqueues the next attempt itself — so BullMQ retries are
 * reserved for our own errors (DB down, vendor client threw).
 */
@Processor(FULFILMENT_QUEUE, { concurrency: 5 })
export class FulfilmentProcessor extends WorkerHost {
  private readonly logger = new Logger(FulfilmentProcessor.name);

  constructor(private readonly fulfilment: FulfilmentService) {
    super();
  }

  async process(job: Job<FulfilmentCheckJob>): Promise<string> {
    const { kind, id, attempt } = job.data;
    const status = await this.fulfilment.check(kind, id, {
      attempt,
      reschedule: true,
    });
    this.logger.debug(
      `[fulfilment] ${kind} ${id} attempt ${attempt} → ${status}`,
    );
    return status;
  }
}
