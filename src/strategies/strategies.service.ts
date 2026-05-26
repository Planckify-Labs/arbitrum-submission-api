import {
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { UpdateStrategyDto } from "./dto/update-strategy.dto";
import { DefiError } from "./errors/defi-error";
import { LifiClient, LifiQuote } from "./external/lifi.client";

interface OpportunityFilter {
  tier?: string;
  assetSymbol?: string;
  chainId?: number;
  liquidityProfile?: string;
  amountUsd?: number;
}

@Injectable()
export class StrategiesService {
  private readonly logger = new Logger(StrategiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifiClient: LifiClient,
  ) {}

  async quoteCrossChain(
    walletAddress: string,
    input: {
      fromChainId: number;
      toChainId: number;
      fromTokenContract: string;
      toTokenContract: string;
      amountRaw: string;
      toAddress?: string;
    },
  ): Promise<LifiQuote> {
    if (input.fromChainId === input.toChainId) {
      throw new DefiError(
        "unsupported_chain",
        "cross-chain quote requested with identical from/to chain",
      );
    }
    const fromAddress = walletAddress.toLowerCase();
    const toAddress = (input.toAddress ?? walletAddress).toLowerCase();
    return this.lifiClient.getRoute(
      input.fromChainId,
      input.toChainId,
      input.fromTokenContract.toLowerCase(),
      input.toTokenContract.toLowerCase(),
      input.amountRaw,
      fromAddress,
      toAddress,
    );
  }

  async getCrossChainStatus(input: {
    fromChainId: number;
    toChainId: number;
    txHash: string;
  }): Promise<{ status: string; substatus?: string }> {
    return this.lifiClient.getStatus(
      input.fromChainId,
      input.toChainId,
      input.txHash,
    );
  }

  async getStrategy(walletAddress: string) {
    const strategy = await this.prisma.userStrategy.findFirst({
      where: {
        walletAddress: walletAddress.toLowerCase(),
      },
      include: {
        positions: {
          where: { status: "active" },
        },
      },
    });

    if (!strategy) {
      throw new DefiError(
        "strategy_not_configured",
        `No strategy found for wallet ${walletAddress}`,
      );
    }

    return strategy;
  }

  async createStrategy(
    userId: string,
    walletAddress: string,
    dto: CreateStrategyDto,
  ) {
    const existing = await this.prisma.userStrategy.findFirst({
      where: {
        walletAddress: walletAddress.toLowerCase(),
      },
    });

    if (existing) {
      throw new DefiError(
        "strategy_paused",
        "Strategy already exists for this wallet",
      );
    }

    const strategy = await this.prisma.userStrategy.create({
      data: {
        userId,
        walletAddress: walletAddress.toLowerCase(),
        namespace: dto.namespace,
        tier: dto.tier,
        assetPreferences: dto.assetPreferences,
        liquidityPref: dto.liquidityPref,
        chainPref: dto.chainPref,
        allocationPct: dto.allocationPct,
        rebalanceTrigger: dto.rebalanceTrigger,
        protocolWhitelist: dto.protocolWhitelist || [],
        allowAllInTier: dto.allowAllInTier ?? false,
        autoCompound: dto.autoCompound ?? false,
        notificationLevel: dto.notificationLevel,
        activatedAt: new Date(),
      },
    });

    return strategy;
  }

  async updateStrategy(walletAddress: string, dto: UpdateStrategyDto) {
    const strategy = await this.prisma.userStrategy.findFirst({
      where: {
        walletAddress: walletAddress.toLowerCase(),
      },
    });

    if (!strategy) {
      throw new DefiError(
        "strategy_not_configured",
        `No strategy found for wallet ${walletAddress}`,
      );
    }

    return await this.prisma.userStrategy.update({
      where: { id: strategy.id },
      data: {
        ...dto,
      },
    });
  }

  async deleteStrategy(walletAddress: string) {
    const strategy = await this.prisma.userStrategy.findFirst({
      where: {
        walletAddress: walletAddress.toLowerCase(),
      },
    });

    if (!strategy) {
      throw new DefiError(
        "strategy_not_configured",
        `No strategy found for wallet ${walletAddress}`,
      );
    }

    return await this.prisma.userStrategy.delete({
      where: { id: strategy.id },
    });
  }

  /**
   * Return scored DeFi opportunities, optionally filtered by transient
   * params from the agent (`tier`, `asset_symbol`, `chain_id`,
   * `liquidity_profile`, `amount_usd`). When the caller has a saved
   * `UserStrategy`, the row's tier wins over the query tier so the
   * agent can't accidentally pull aggressive options for a conservative
   * user.
   *
   * Source of truth: `OpportunityCache`, populated by the
   * `defillama-poll` worker. Empty result = no opportunities; callers
   * render an empty state. No client-side or server-side fallback to
   * hardcoded data — production never serves seed/mock rows.
   */
  async getOpportunities(
    walletAddress: string,
    filter: OpportunityFilter = {},
  ) {
    const wallet = walletAddress.toLowerCase();
    this.logger.log(
      `[getOpportunities] wallet=${wallet} filter=${JSON.stringify(filter)}`,
    );

    const strategy = await this.prisma.userStrategy.findFirst({
      where: { walletAddress: wallet },
    });

    const effectiveTier = strategy?.tier ?? filter.tier;
    if (strategy?.tier && filter.tier && strategy.tier !== filter.tier) {
      this.logger.log(
        `[getOpportunities] tier override: query="${filter.tier}" -> strategy="${strategy.tier}"`,
      );
    }

    const where: Record<string, unknown> = {};
    if (effectiveTier) where.tier = effectiveTier;
    if (filter.assetSymbol) where.assetSymbol = filter.assetSymbol;
    if (filter.chainId !== undefined) where.chainId = filter.chainId;

    const opportunities = await this.prisma.opportunityCache.findMany({
      where,
      orderBy: { score: "desc" },
    });
    this.logger.log(
      `[getOpportunities] OpportunityCache returned ${opportunities.length} rows for where=${JSON.stringify(where)}`,
    );
    return opportunities;
  }

  async getOpportunity(slug: string) {
    const opportunity = await this.prisma.opportunityCache.findFirst({
      where: {
        protocolSlug: slug,
      },
    });

    if (!opportunity) {
      throw new DefiError("protocol_not_found", slug);
    }

    return opportunity;
  }

  /**
   * Returns the protocol allowlist for a given tier — the canonical
   * set the user can pick from when narrowing their `protocolWhitelist`
   * in `/strategies/settings` (spec §21.2). Read exclusively from
   * `OpportunityCache` (the live, scored set kept fresh by the
   * `defillama-poll` worker). Empty result = nothing curated for this
   * tier yet; clients render an empty state.
   *
   * Deduplicated by `protocolSlug` — each cached pool can appear
   * multiple times across assets, but the whitelist key is the slug,
   * so the picker only needs one row per slug. `chainName` is the
   * DefiLlama-provided label stored on the row at poll time (works
   * uniformly for EVM, Solana, and Sui).
   */
  async getProtocols(tier?: string) {
    const where: Record<string, unknown> = {};
    if (tier) where.tier = tier;

    const source = await this.prisma.opportunityCache.findMany({
      where,
      orderBy: { score: "desc" },
    });

    const seen = new Map<
      string,
      {
        protocolSlug: string;
        namespace: string;
        chainId: number;
        chainName: string;
        tier: string;
        assetSymbol: string;
      }
    >();
    for (const o of source) {
      if (seen.has(o.protocolSlug)) continue;
      seen.set(o.protocolSlug, {
        protocolSlug: o.protocolSlug,
        namespace: o.namespace,
        chainId: o.chainId,
        chainName: o.chainName,
        tier: o.tier,
        assetSymbol: o.assetSymbol,
      });
    }
    return Array.from(seen.values());
  }

  async getPositions(walletAddress: string) {
    return await this.prisma.strategyPosition.findMany({
      where: {
        walletAddress: walletAddress.toLowerCase(),
      },
      orderBy: {
        openedAt: "desc",
      },
    });
  }

  async getPosition(id: string, walletAddress: string) {
    const position = await this.prisma.strategyPosition.findFirst({
      where: {
        id,
        walletAddress: walletAddress.toLowerCase(),
      },
    });

    if (!position) {
      throw new DefiError("position_not_found", id);
    }

    return position;
  }

  async createPosition(
    walletAddress: string,
    dto: {
      protocolSlug: string;
      chainId: number;
      namespace: string;
      assetSymbol: string;
      assetContract?: string;
      amountAtDeposit: string;
      amountAtDepositUsd: number;
      openTxHash?: string;
      goal?: string;
      targetDate?: Date;
    },
  ) {
    const strategy = await this.prisma.userStrategy.findFirst({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (!strategy) {
      throw new DefiError(
        "strategy_not_configured",
        `No strategy found for wallet ${walletAddress}. Create a strategy first.`,
      );
    }

    const amountUsd =
      Number.isFinite(dto.amountAtDepositUsd) && dto.amountAtDepositUsd != null
        ? dto.amountAtDepositUsd
        : 0;

    // Inherit chainName from the source OpportunityCache row (DefiLlama-
    // provided label). Works uniformly for EVM (chainId match) and non-EVM
    // (chainId=0 with namespace discriminator).
    const sourceOpp = await this.prisma.opportunityCache.findFirst({
      where: {
        protocolSlug: dto.protocolSlug,
        chainId: dto.chainId,
        namespace: dto.namespace,
      },
      select: { chainName: true },
    });

    try {
      return await this.prisma.strategyPosition.create({
        data: {
          userStrategy: { connect: { id: strategy.id } },
          walletAddress: walletAddress.toLowerCase(),
          protocolSlug: dto.protocolSlug,
          chainId: dto.chainId,
          namespace: dto.namespace,
          chainName: sourceOpp?.chainName ?? "",
          assetSymbol: dto.assetSymbol,
          assetContract: dto.assetContract,
          amountAtDeposit: dto.amountAtDeposit,
          amountAtDepositUsd: amountUsd,
          status: "active",
          openTxHash: dto.openTxHash,
          openedAt: new Date(),
          goal: dto.goal,
          targetDate: dto.targetDate,
        },
      });
    } catch (err) {
      this.logger.error(
        `[createPosition] prisma create failed for wallet=${walletAddress} slug=${dto.protocolSlug}: ${(err as Error).name}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async refreshPosition(id: string, walletAddress: string) {
    const position = await this.getPosition(id, walletAddress);

    return {
      ...position,
      refreshedAt: new Date(),
      status: "refreshed_stub",
    };
  }
}
