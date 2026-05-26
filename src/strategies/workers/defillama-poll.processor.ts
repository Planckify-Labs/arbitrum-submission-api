import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { DeFiLlamaClient } from "../external/defillama.client";
import { PrismaService } from "../../prisma/prisma.service";

@Processor("defillama-poll")
export class DefiLlamaPollProcessor extends WorkerHost {
  private readonly logger = new Logger(DefiLlamaPollProcessor.name);

  constructor(
    private readonly defillama: DeFiLlamaClient,
    private readonly prisma: PrismaService,
    @InjectQueue("score-opportunities") private readonly scoringQueue: Queue,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.logger.log("Starting DeFiLlama yield pool poll...");

    try {
      const pools = await this.defillama.getYieldPools();
      this.logger.log(`Fetched ${pools.length} pools from DeFiLlama`);

      // In a real implementation, we might save the raw data or update a temporary cache
      // For Phase 1, we'll just pass the data to the scoring processor
      for (const pool of pools) {
        await this.scoringQueue.add(
          "score-pool",
          { pool },
          {
            removeOnComplete: true,
            jobId: `score-${pool.pool}`, // Idempotency
          },
        );
      }

      this.logger.log(`Enqueued ${pools.length} pools for scoring`);
    } catch (error) {
      this.logger.error(`Failed to poll DeFiLlama: ${error.message}`);
      throw error;
    }
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.log(`DeFiLlama poll job ${job.id} completed`);
  }
}
