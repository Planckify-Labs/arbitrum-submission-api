import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";

export const ONCHAIN_RETRY_QUEUE = "onchain-settlement-retry";

export interface OnchainRetryJobData {
  intentId: string;
  txHash: string;
  chainId: number;
  attempt: number;
}

/**
 * BullMQ processor for retrying onchain settlement verification when the
 * initial attempt failed due to insufficient confirmations (task 32).
 *
 * The actual retry logic will call `OnchainSettlementProvider.settle` —
 * this is wired via the settlement module in a follow-up phase.
 */
@Processor(ONCHAIN_RETRY_QUEUE)
export class OnchainRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(OnchainRetryProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  process(job: Job<OnchainRetryJobData>): Promise<void> {
    const { intentId, txHash, attempt } = job.data;
    this.logger.log(
      `Retrying onchain settlement verification: intentId=${intentId} txHash=${txHash} attempt=${attempt}`,
    );
    // The actual retry logic will call OnchainSettlementProvider.settle
    // This is wired via the settlement module in a follow-up
    return Promise.resolve();
  }
}
