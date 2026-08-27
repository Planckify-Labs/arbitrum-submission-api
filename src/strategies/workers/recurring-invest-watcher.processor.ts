import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";
import { RecurringInvestService } from "../recurring-invest.service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** One scan should never be able to spam a user's whole backlog. */
const MAX_PLANS_PER_SCAN = 500;

/**
 * Recurring-invest watcher — DCA v1
 * (mobile-app docs/defi-quick-invest-spec.md §12.4).
 *
 * Structurally the auto-compound watcher: a daily cron scans opted-in rows
 * and pushes a nudge. **The query and the push are namespace-free** — this
 * processor never inspects the plan's chain beyond joining it for a display
 * name, never touches an RPC, never handles an address beyond passing the
 * plan's own stored value to `PushService`. That is what makes the whole
 * recurring layer chain-agnostic for free (§12.1a): the actual deposit is
 * delegated to the existing `defi_deposit` path, which already routes by
 * namespace through the walletKit registry on the device.
 *
 * **Dedup differs from auto-compound's, deliberately.** That watcher writes
 * a `StrategyPositionEvent` row keyed `(positionId, kind:<bucket>)` and
 * leans on the unique constraint. A plan is not a position, so mirroring it
 * would mean a whole new event table. Instead the claim is a conditional
 * `updateMany` on the plan's own `nextDueAt` — a compare-and-swap that is
 * strictly stronger than the unique-constraint race it replaces: two
 * overlapping scans cannot both win because the loser's `WHERE nextDueAt <=
 * now` no longer matches once the winner has advanced it. Same guarantee,
 * one less table.
 *
 * **Missed cycles skip, they never stack (§12.6).** `nextDueAt` always
 * advances to the next FUTURE slot whether or not the user acted. Stacking
 * would pile up reminders about money the user has already implicitly
 * declined to invest, and — worse — could produce a catch-up prompt for a
 * doubled amount nobody asked for.
 *
 * The watcher keeps nudging regardless of the device's session state, and
 * that is correct: push-token registration is independent of the JWT, the
 * server cannot know a device's session died, and the plan is still valid.
 * Handling an expired session belongs entirely on the landing side
 * (§12.5b).
 */
@Processor("recurring-invest-watcher")
export class RecurringInvestWatcherProcessor extends WorkerHost {
  private readonly logger = new Logger(RecurringInvestWatcherProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly recurringInvestService: RecurringInvestService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    const due = await this.prisma.recurringInvestPlan.findMany({
      where: { status: "active", nextDueAt: { lte: now } },
      orderBy: { nextDueAt: "asc" },
      take: MAX_PLANS_PER_SCAN,
    });

    if (due.length === 0) {
      this.logger.debug("[recurring-invest-watcher] nothing due");
      return;
    }

    const chainNames = await this.recurringInvestService.chainNamesByCaip2();
    let pushed = 0;
    let skippedRace = 0;
    let skippedNoTokens = 0;

    for (const plan of due) {
      const claimed = await this.claim(plan.id, now, plan.cadenceDays);
      if (!claimed) {
        skippedRace += 1;
        continue;
      }

      const chainName = chainNames.get(plan.caip2Id);
      const amount = formatUsd(plan.amountUsd);
      const tierWord = TIER_WORD[plan.tier] ?? plan.tier;

      // The payload's `prompt` is what the device replays into the agent as
      // if the user had typed it, landing on the normal
      // `defi_list_opportunities` → Simulator path (§12.5). Product wording
      // only: no vendor, no infrastructure, no internal identifiers.
      const result = await this.pushService.sendToWallet({
        walletAddress: plan.walletAddress,
        title: "Time to add to your plan",
        body: chainName
          ? `Tap to add ${amount} of ${plan.assetSymbol} on ${chainName}.`
          : `Tap to add ${amount} of ${plan.assetSymbol}.`,
        data: {
          kind: "recurring_invest_nudge",
          planId: plan.id,
          prompt: `Invest ${amount} of ${plan.assetSymbol} into my ${tierWord} mix.`,
        },
        channelId: "strategies",
        source: "recurring-invest-watcher",
      });

      if (result.attempted === 0) skippedNoTokens += 1;
      else pushed += 1;
    }

    this.logger.log(
      `[recurring-invest-watcher] scan complete. due=${due.length} pushed=${pushed} ` +
        `skipped_race=${skippedRace} skipped_no_tokens=${skippedNoTokens}`,
    );
  }

  /**
   * Atomically claim this cycle and advance to the next FUTURE slot.
   *
   * Returns `true` only when this call was the one that moved the row, so a
   * cron that fires twice in a window nudges once. The advance loop is what
   * implements "missed cycles skip": a plan dormant for three months lands
   * on the next upcoming date, not three months of backlog.
   */
  private async claim(
    planId: string,
    now: Date,
    cadenceDays: number,
  ): Promise<boolean> {
    const step = cadenceDays * MS_PER_DAY;
    let next = now.getTime() + step;
    // Defensive: a corrupt cadence of 0 would spin forever.
    if (!Number.isFinite(step) || step <= 0) next = now.getTime() + MS_PER_DAY;

    const { count } = await this.prisma.recurringInvestPlan.updateMany({
      where: { id: planId, status: "active", nextDueAt: { lte: now } },
      data: { nextDueAt: new Date(next), lastNudgedAt: now },
    });
    return count === 1;
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Recurring-invest watcher job ${job.id} completed`);
  }
}

const TIER_WORD: Record<string, string> = {
  conservative: "safest",
  balanced: "balanced",
  aggressive: "higher-growth",
};

function formatUsd(value: number): string {
  const cents = Math.abs(value) < 100 && value % 1 !== 0;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`;
}
