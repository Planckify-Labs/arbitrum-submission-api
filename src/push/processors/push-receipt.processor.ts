import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import {
  PUSH_RECEIPTS_QUEUE,
  type PushReceiptEntry,
  PushService,
} from "../push.service";

@Processor(PUSH_RECEIPTS_QUEUE, { concurrency: 5 })
export class PushReceiptProcessor extends WorkerHost {
  private readonly logger = new Logger(PushReceiptProcessor.name);

  constructor(private readonly pushService: PushService) {
    super();
  }

  async process(job: Job<{ entries: PushReceiptEntry[] }>): Promise<void> {
    await this.pushService.checkReceipts(job.data.entries);
    this.logger.log(
      `Checked ${job.data.entries.length} push receipt(s) for job ${job.id}`,
    );
  }
}
