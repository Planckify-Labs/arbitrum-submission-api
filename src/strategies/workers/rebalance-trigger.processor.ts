import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";

@Processor("rebalance-trigger")
export class RebalanceTriggerProcessor extends WorkerHost {
  private readonly logger = new Logger(RebalanceTriggerProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.logger.log("Scanning user strategies for rebalance triggers...");

    const activeStrategies = await this.prisma.userStrategy.findMany({
      where: { activatedAt: { not: null }, pausedAt: null },
    });

    for (const strategy of activeStrategies) {
      const trigger = strategy.rebalanceTrigger as any;

      if (trigger?.kind === "yield_drop") {
        this.logger.debug(
          `Checking yield drop trigger for strategy ${strategy.id}`,
        );
        // Logic to check if current yield is < threshold from when it was deposited
      } else if (trigger?.kind === "interval") {
        this.logger.debug(
          `Checking interval trigger for strategy ${strategy.id} (${trigger.value})`,
        );
        // Logic to check if last rebalance was > interval ago
      }
    }

    this.logger.log(
      `Rebalance scan complete. Checked ${activeStrategies.length} strategies.`,
    );
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Rebalance trigger job ${job.id} completed`);
  }
}
