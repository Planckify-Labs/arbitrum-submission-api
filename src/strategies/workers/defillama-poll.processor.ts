import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { DeFiLlamaClient } from "../external/defillama.client";
import { SuiLstSource } from "../external/sui-lst.source";
import { PrismaService } from "../../prisma/prisma.service";

@Processor("defillama-poll")
export class DefiLlamaPollProcessor extends WorkerHost {
  private readonly logger = new Logger(DefiLlamaPollProcessor.name);

  constructor(
    private readonly defillama: DeFiLlamaClient,
    private readonly suiLstSource: SuiLstSource,
    private readonly prisma: PrismaService,
    @InjectQueue("score-opportunities") private readonly scoringQueue: Queue,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.logger.log("Starting DeFiLlama yield pool poll...");

    try {
      const feedPools = await this.defillama.getYieldPools();
      // Sui liquid-staking venues aren't in DeFiLlama's /pools — synthesize their
      // rows (real APY + TVL) and append so they flow through the same scoring +
      // target-resolution path. Failure here must not sink the whole poll.
      const lstPools = await this.suiLstSource.getPools().catch((err) => {
        this.logger.error(`Sui LST source failed: ${err.message}`);
        return [];
      });
      const pools = [...feedPools, ...lstPools];
      this.logger.log(
        `Fetched ${feedPools.length} pools from DeFiLlama (+${lstPools.length} synthesized Sui LST)`,
      );

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
