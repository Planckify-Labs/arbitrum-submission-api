import { Injectable, Logger } from "@nestjs/common";
import { DeFiLlamaYieldPool } from "../external/defillama.client";

export interface ScoringDimensions {
  protocolSafety: number; // 0-100
  yieldSustainability: number; // 0-100
  liquidityAndExit: number; // 0-100
  marketExposure: number; // 0-100
  chainAndBridge: number; // 0-100
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  /**
   * Calculate a composite score and tier for a DeFi opportunity.
   */
  calculateScore(dimensions: ScoringDimensions): {
    score: number;
    tier: "conservative" | "balanced" | "aggressive";
  } {
    // Spec §8 weights — sums to 1.0.
    const weights = {
      protocolSafety: 0.3,
      yieldSustainability: 0.25,
      liquidityAndExit: 0.2,
      marketExposure: 0.15,
      chainAndBridge: 0.1,
    };

    const compositeScore = Math.round(
      dimensions.protocolSafety * weights.protocolSafety +
        dimensions.yieldSustainability * weights.yieldSustainability +
        dimensions.liquidityAndExit * weights.liquidityAndExit +
        dimensions.marketExposure * weights.marketExposure +
        dimensions.chainAndBridge * weights.chainAndBridge,
    );

    let tier: "conservative" | "balanced" | "aggressive";
    if (compositeScore >= 80) {
      tier = "conservative";
    } else if (compositeScore >= 50) {
      tier = "balanced";
    } else {
      tier = "aggressive";
    }

    return { score: compositeScore, tier };
  }

  /**
   * Map raw DeFiLlama pool data to scoring dimensions.
   * This is a simplified heuristic for Phase 1.
   */
  mapPoolToDimensions(
    pool: DeFiLlamaYieldPool,
    protocolMetadata: { auditCount: number },
  ): ScoringDimensions {
    // Protocol Safety (based on audits and age)
    const protocolSafety = protocolMetadata.auditCount > 0 ? 85 : 40;

    // Yield Sustainability (higher TVL and 7d avg stability = better)
    const yieldSustainability = pool.apy < 15 ? 90 : pool.apy < 50 ? 60 : 30;

    // Liquidity and Exit (TVL based)
    const liquidityAndExit =
      pool.tvlUsd > 100000000 ? 95 : pool.tvlUsd > 10000000 ? 70 : 40;

    // Market Exposure (stable = 100, single = 80, multi = 50)
    let marketExposure = 50;
    if (pool.exposure === "stable") marketExposure = 100;
    else if (pool.exposure === "single") marketExposure = 80;

    // Chain and Bridge (L1 = 90, Major L2 = 80, Others = 60)
    const majorChains = [
      "Ethereum",
      "Solana",
      "Arbitrum",
      "Polygon",
      "Optimism",
      "Base",
    ];
    const chainAndBridge = majorChains.includes(pool.chain) ? 90 : 60;

    return {
      protocolSafety,
      yieldSustainability,
      liquidityAndExit,
      marketExposure,
      chainAndBridge,
    };
  }
}
