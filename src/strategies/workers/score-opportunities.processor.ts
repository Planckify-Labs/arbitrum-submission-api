import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { ScoringService } from "../scoring/scoring.service";
import {
  DeFiLlamaClient,
  DeFiLlamaYieldPool,
} from "../external/defillama.client";

interface ScorePoolJobData {
  pool: DeFiLlamaYieldPool;
}

// DeFiLlama chain name -> (namespace, chainId).
// chainId is 0 for non-EVM (carry namespace as the discriminator, matching the
// OpportunityCache schema comment).
const CHAIN_NAME_MAP: Record<
  string,
  { namespace: "eip155" | "solana" | "sui"; chainId: number }
> = {
  ethereum: { namespace: "eip155", chainId: 1 },
  optimism: { namespace: "eip155", chainId: 10 },
  bsc: { namespace: "eip155", chainId: 56 },
  polygon: { namespace: "eip155", chainId: 137 },
  base: { namespace: "eip155", chainId: 8453 },
  arbitrum: { namespace: "eip155", chainId: 42161 },
  avalanche: { namespace: "eip155", chainId: 43114 },
  solana: { namespace: "solana", chainId: 0 },
  sui: { namespace: "sui", chainId: 0 },
};

function resolveChain(chainName: string): {
  namespace: "eip155" | "solana" | "sui";
  chainId: number;
} {
  return (
    CHAIN_NAME_MAP[chainName?.toLowerCase?.() ?? ""] ?? {
      namespace: "eip155",
      chainId: 0,
    }
  );
}

@Processor("score-opportunities")
export class ScoreOpportunitiesProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoreOpportunitiesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: ScoringService,
    private readonly defillama: DeFiLlamaClient,
  ) {
    super();
  }

  async process(job: Job<ScorePoolJobData>): Promise<void> {
    const { pool } = job.data;
    this.logger.debug(
      `Scoring pool ${pool.pool} (${pool.symbol} on ${pool.project})`,
    );

    try {
      const protocolMetadata = await this.defillama.getProtocolMetadata(
        pool.project,
      );

      const dimensions = this.scoringService.mapPoolToDimensions(
        pool,
        protocolMetadata,
      );
      const { score, tier } = this.scoringService.calculateScore(dimensions);

      const { namespace, chainId } = resolveChain(pool.chain);

      // Upsert into OpportunityCache
      await this.prisma.opportunityCache.upsert({
        where: { poolId: pool.pool },
        update: {
          protocolSlug: pool.project,
          chainId,
          namespace,
          chainName: pool.chain,
          assetSymbol: pool.symbol,
          apy: pool.apy,
          apy7dAvg: pool.apy7d || pool.apy,
          apyStddev30d: 0,
          tvlUsd: pool.tvlUsd,
          tvl7dDelta: 0,
          ilExposure: pool.ilRisk === "yes",
          score,
          tier,
          raw: pool as any,
          scoredAt: new Date(),
        },
        create: {
          poolId: pool.pool,
          protocolSlug: pool.project,
          chainId,
          namespace,
          chainName: pool.chain,
          assetSymbol: pool.symbol,
          apy: pool.apy,
          apy7dAvg: pool.apy7d || pool.apy,
          apyStddev30d: 0,
          tvlUsd: pool.tvlUsd,
          tvl7dDelta: 0,
          ilExposure: pool.ilRisk === "yes",
          score,
          tier,
          raw: pool as any,
          scoredAt: new Date(),
        },
      });

      this.logger.debug(`Saved score ${score} (${tier}) for pool ${pool.pool}`);
    } catch (error) {
      this.logger.error(`Failed to score pool ${pool.pool}: ${error.message}`);
      throw error;
    }
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Scoring job ${job.id} completed`);
  }
}
