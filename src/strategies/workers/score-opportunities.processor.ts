import { Prisma } from "@generated/prisma";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { ValkeyService } from "../../valkey/valkey.service";
import {
  DeFiLlamaClient,
  DeFiLlamaYieldPool,
} from "../external/defillama.client";
import { ScoringService } from "../scoring/scoring.service";
import { oppRowCacheKey } from "../targets/cache-keys";
import { TargetResolverService } from "../targets/target-resolver.service";

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
    private readonly targetResolver: TargetResolverService,
    private readonly valkey: ValkeyService,
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

      // Pool-level deposits (spec §3, §4.2, §6): resolve the on-chain deposit
      // target from the pool's matching keys, on-chain-validated. `null` ⇒ the
      // pool degrades to the manual deep-link path (fail-closed).
      const depositTarget = await this.targetResolver.resolve(pool);
      const poolMeta = pool.poolMeta ?? null;
      const assetContract =
        typeof pool.underlyingTokens?.[0] === "string"
          ? pool.underlyingTokens[0].toLowerCase()
          : null;
      const targetJson: Prisma.OpportunityCacheUpdateInput["depositTarget"] =
        depositTarget
          ? (depositTarget as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull;
      const targetResolvedAt = depositTarget ? new Date() : null;

      // Upsert into OpportunityCache
      await this.prisma.opportunityCache.upsert({
        where: { poolId: pool.pool },
        update: {
          protocolSlug: pool.project,
          chainId,
          namespace,
          chainName: pool.chain,
          assetSymbol: pool.symbol,
          assetContract,
          poolMeta,
          depositTarget: targetJson,
          targetResolvedAt,
          apy: pool.apy,
          apy7dAvg: pool.apy7d || pool.apy,
          apyStddev30d: 0,
          tvlUsd: pool.tvlUsd,
          tvl7dDelta: 0,
          ilExposure: pool.ilRisk === "yes",
          score,
          tier,
          raw: pool as unknown as Prisma.InputJsonValue,
          scoredAt: new Date(),
        },
        create: {
          poolId: pool.pool,
          protocolSlug: pool.project,
          chainId,
          namespace,
          chainName: pool.chain,
          assetSymbol: pool.symbol,
          assetContract,
          poolMeta,
          depositTarget: targetJson,
          targetResolvedAt,
          apy: pool.apy,
          apy7dAvg: pool.apy7d || pool.apy,
          apyStddev30d: 0,
          tvlUsd: pool.tvlUsd,
          tvl7dDelta: 0,
          ilExposure: pool.ilRisk === "yes",
          score,
          tier,
          raw: pool as unknown as Prisma.InputJsonValue,
          scoredAt: new Date(),
        },
      });

      // Persist protocol-level metadata (safety + app URL for the manual
      // deep-link homepage fallback, spec §9.1). Protocol-scoped, so it isn't
      // duplicated per sibling pool.
      await this.prisma.protocolScoreCache
        .upsert({
          where: { protocolSlug: pool.project },
          update: {
            safetyScore: dimensions.protocolSafety,
            auditCount: protocolMetadata.auditCount,
            appUrl: protocolMetadata.appUrl,
            computedAt: new Date(),
          },
          create: {
            protocolSlug: pool.project,
            safetyScore: dimensions.protocolSafety,
            auditCount: protocolMetadata.auditCount,
            protocolAgeDays: 0,
            exploitHistoryFlag: false,
            tvlTrendBps: 0,
            appUrl: protocolMetadata.appUrl,
            computedAt: new Date(),
          },
        })
        .catch((err) => {
          this.logger.warn(
            `ProtocolScoreCache upsert failed for ${pool.project}: ${err?.message ?? err}`,
          );
        });

      // Invalidate the Valkey row cache so the executor's authoritative
      // depositTarget re-fetch (§6) sees the fresh row.
      await this.valkey.del(oppRowCacheKey(pool.pool)).catch(() => undefined);

      this.logger.debug(
        `Saved score ${score} (${tier}) for pool ${pool.pool} (target=${depositTarget?.kind ?? "manual"})`,
      );
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
