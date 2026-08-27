import { Injectable, Logger } from "@nestjs/common";
import {
  buildCaip2Id,
  type TBlockchainRow,
} from "../blockchains/blockchain-enricher";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateRecurringInvestPlanDto,
  UpdateRecurringInvestPlanDto,
} from "./dto/recurring-invest.dto";
import { DefiError } from "./errors/defi-error";
import { StrategiesService } from "./strategies.service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Recurring investment plans — DCA v1
 * (mobile-app docs/defi-quick-invest-spec.md §12).
 *
 * What this is: the server remembers a cadence and nudges. The user taps
 * once and their own key signs, exactly like the auto-compound feature
 * already live in production. **No new signing authority is created
 * anywhere** — §13's unattended variant is explicitly not built here.
 *
 * Three properties are structural rather than documented-and-hoped-for:
 *
 *  - **The owner is never an input (§12.3a Rule 1).** Every method takes
 *    `walletAddress` from the controller's `getWalletAddress(req)`, i.e.
 *    from the JWT. No DTO in this feature carries a wallet field.
 *  - **Therefore this file canonicalizes nothing (Rule 2).** The JWT's
 *    address was already canonicalized at issuance, arrives canonical and
 *    is stored verbatim. A `canonicalizeWalletAddress` call appearing in
 *    this file would mean an address is entering from somewhere other than
 *    the JWT — treat one as a smell, not a fix. Likewise `.toLowerCase()`:
 *    Solana (base58) and Stellar (base32 StrKey) are case-significant, and
 *    a folded row would never be found for its own owner.
 *  - **Nothing here knows what a chain is.** Plans are keyed by CAIP-2 and
 *    validated against the Blockchain table. There is no namespace
 *    comparison in this file, and a new chain becomes plan-capable by
 *    having a row and a deposit adapter, with zero edits here (§12.1a).
 */
@Injectable()
export class RecurringInvestService {
  private readonly logger = new Logger(RecurringInvestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategiesService: StrategiesService,
  ) {}

  /**
   * CAIP-2 → the chain's display name, for chains this deployment actually
   * serves. `buildCaip2Id` returns `null` for rows lacking the underlying
   * data, so those rows simply never match — which is the right outcome: a
   * plan pinned to a chain we cannot identify is not a plan.
   */
  async chainNamesByCaip2(): Promise<Map<string, string>> {
    const rows = await this.prisma.blockchain.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        chainId: true,
        chainSlug: true,
        type: true,
        rpcUrl: true,
        blockExplorer: true,
        isActive: true,
        isTestnet: true,
      },
    });
    const map = new Map<string, string>();
    for (const row of rows) {
      const caip2 = buildCaip2Id(row as unknown as TBlockchainRow);
      if (caip2) map.set(caip2, row.name);
    }
    return map;
  }

  /**
   * Create (or replace) the plan for one `(wallet, chain, asset)`.
   *
   * Replace rather than reject or duplicate: "set up $25 a week into USDC
   * on Base" said twice is one intention stated twice, and two standing
   * orders the user does not know about is the worst of the three outcomes.
   * The response says which happened so the confirmation copy can too.
   */
  async createPlan(
    userId: string,
    walletAddress: string,
    dto: CreateRecurringInvestPlanDto,
  ) {
    const chainNames = await this.chainNamesByCaip2();
    const chainName = chainNames.get(dto.caip2Id);
    if (!chainName) {
      throw new DefiError(
        "unsupported_chain",
        `no active blockchain row for caip2Id=${dto.caip2Id}`,
      );
    }

    // §12.6 requirement 1: plan and saved strategy agree from the start, so
    // the common case never hits the divergence path below. `getOpportunities`
    // gives `strategy?.tier` precedence over any query filter, which is the
    // correct safety ceiling — the point is that it must not surprise anyone.
    // The namespace is the CAIP-2 prefix, derived rather than stored twice.
    const namespace = dto.caip2Id.split(":")[0];
    await this.strategiesService.ensureUserStrategy(
      userId,
      walletAddress,
      namespace,
      dto.tier,
    );

    const assetSymbol = dto.assetSymbol.trim().toUpperCase();
    const existing = await this.prisma.recurringInvestPlan.findFirst({
      where: {
        walletAddress,
        caip2Id: dto.caip2Id,
        assetSymbol,
        status: { in: ["active", "paused"] },
      },
    });

    const nextDueAt = new Date(Date.now() + dto.cadenceDays * MS_PER_DAY);
    const data = {
      walletAddress,
      caip2Id: dto.caip2Id,
      assetSymbol,
      amountUsd: dto.amountUsd,
      tier: dto.tier,
      cadenceDays: dto.cadenceDays,
      status: "active",
      // The first reminder is one full cycle out, never immediate: the
      // surface where a plan gets set up is itself the first chance to
      // invest, so nudging the same day would be nagging about something
      // the user has just been offered.
      nextDueAt,
    };

    const plan = existing
      ? await this.prisma.recurringInvestPlan.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.recurringInvestPlan.create({ data });

    this.logger.log(
      `[recurring-invest] ${existing ? "replaced" : "created"} plan ${plan.id} ` +
        `chain=${dto.caip2Id} asset=${assetSymbol} cadenceDays=${dto.cadenceDays}`,
    );

    return {
      ...(await this.decorate(plan, chainNames, walletAddress)),
      replaced: !!existing,
    };
  }

  async listPlans(walletAddress: string) {
    const [plans, chainNames] = await Promise.all([
      this.prisma.recurringInvestPlan.findMany({
        where: { walletAddress, status: { in: ["active", "paused"] } },
        orderBy: { nextDueAt: "asc" },
      }),
      this.chainNamesByCaip2(),
    ]);
    return Promise.all(
      plans.map((p) => this.decorate(p, chainNames, walletAddress)),
    );
  }

  async updateStatus(
    walletAddress: string,
    planId: string,
    dto: UpdateRecurringInvestPlanDto,
  ) {
    // Scoped by owner, not just by id: a plan id alone must never be enough
    // to touch someone else's standing order.
    const plan = await this.prisma.recurringInvestPlan.findFirst({
      where: { id: planId, walletAddress },
    });
    if (!plan) {
      throw new DefiError("plan_not_found", `planId=${planId}`);
    }
    if (plan.status === "cancelled") {
      // Terminal on purpose: a user who ended a standing order must never
      // find it running again.
      throw new DefiError("plan_not_found", `planId=${planId} already cancelled`);
    }

    const updated = await this.prisma.recurringInvestPlan.update({
      where: { id: plan.id },
      data: {
        status: dto.status,
        // Resuming restarts the clock rather than firing immediately for
        // every cycle missed while paused (§12.6: missed cycles skip).
        ...(dto.status === "active" && plan.status === "paused"
          ? { nextDueAt: new Date(Date.now() + plan.cadenceDays * MS_PER_DAY) }
          : {}),
      },
    });
    return this.decorate(updated, await this.chainNamesByCaip2(), walletAddress);
  }

  /**
   * Adds the two things a client cannot compute for itself: the chain's
   * display name, and whether the user's saved risk profile currently
   * overrides the plan's tier.
   *
   * That override is real (`getOpportunities` resolves
   * `strategy?.tier ?? filter.tier`) and it must stay — it is the ceiling
   * behind "never propose protocols above the user's risk tier". What is
   * not acceptable is applying it silently: someone who set up "$25/week
   * into Balanced" and later onboarded as Conservative would otherwise land
   * on a conservative list with no explanation (§12.6).
   */
  private async decorate(
    plan: {
      id: string;
      caip2Id: string;
      assetSymbol: string;
      amountUsd: number;
      tier: string;
      cadenceDays: number;
      status: string;
      executionMode: string;
      nextDueAt: Date;
      createdAt: Date;
    },
    chainNames: Map<string, string>,
    walletAddress: string,
  ) {
    // Delegated, not queried directly: `UserStrategy` stores its wallet
    // address lowercased (a convention predating the per-encoding rule), and
    // folding an address inside this layer is precisely the §12.3a Rule 2
    // smell. `StrategiesService` owns that table and its convention.
    const savedTier = await this.strategiesService.getSavedTier(walletAddress);
    const effectiveTier = savedTier ?? plan.tier;
    return {
      id: plan.id,
      caip2Id: plan.caip2Id,
      chainName: chainNames.get(plan.caip2Id) ?? null,
      assetSymbol: plan.assetSymbol,
      amountUsd: plan.amountUsd,
      tier: plan.tier,
      effectiveTier,
      /** True when the saved strategy will override the plan's tier. */
      tierOverridden: effectiveTier !== plan.tier,
      cadenceDays: plan.cadenceDays,
      status: plan.status,
      executionMode: plan.executionMode,
      nextDueAt: plan.nextDueAt.toISOString(),
      createdAt: plan.createdAt.toISOString(),
    };
  }
}
