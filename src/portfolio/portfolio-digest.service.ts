import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ZerionClient } from "../external/zerion/zerion.client";
import { NotificationCategory } from "../push/notification-categories";
import { NotificationPreferencesService } from "../push/notification-preferences.service";
import { PushService } from "../push/push.service";
import { normalizeForZerion } from "../wallet-activity/zerion-subscription-sync.service";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * The opt-in daily portfolio summary: "Portfolio today: $1,234.56 (+3.2%)".
 *
 * Runs at five past every hour and sends to the users whose chosen
 * `digestHourUtc` is this hour (default 02:00 UTC = 09:00 WIB). Each
 * recipient costs one Zerion portfolio request against the shared daily
 * budget, which is why the category is off by default and the recipient
 * set is exactly the explicit opt-ins. Keyed per user per day, so a
 * restart inside the hour can't send twice.
 */
@Injectable()
export class PortfolioDigestService {
  private readonly logger = new Logger(PortfolioDigestService.name);

  constructor(
    private readonly zerion: ZerionClient,
    private readonly preferences: NotificationPreferencesService,
    private readonly pushService: PushService,
  ) {}

  @Cron("5 * * * *", { name: "portfolio-digest" })
  async run(
    now: Date = new Date(),
  ): Promise<{ sent: number; skipped: number }> {
    const hour = now.getUTCHours();
    const day = now.toISOString().slice(0, 10);
    const recipients = await this.preferences.digestRecipientsForHour(hour);
    let sent = 0;
    let skipped = 0;
    for (const { userId, walletAddress } of recipients) {
      // Only EVM/Solana wallets have a Zerion portfolio.
      const [wallet] = normalizeForZerion([walletAddress]);
      if (!wallet) {
        skipped += 1;
        continue;
      }
      try {
        const summary = readPortfolio(await this.zerion.getPortfolio(wallet));
        if (!summary) {
          skipped += 1;
          continue;
        }
        const result = await this.pushService.sendToUser({
          userId,
          ...digestCopy(summary),
          category: NotificationCategory.portfolio_digest,
          channelId: "portfolio",
          source: "portfolio_digest",
          dedupeKey: `digest:${userId}:${day}`,
          // Yesterday's digest delivered today is just wrong.
          ttlSeconds: 6 * 60 * 60,
          data: {
            type: "portfolio_digest",
            totalUsd: summary.totalUsd,
            change1dUsd: summary.change1dUsd,
            change1dPercent: summary.change1dPercent,
          },
        });
        if (result.deduplicated || result.muted) skipped += 1;
        else sent += 1;
      } catch (err) {
        skipped += 1;
        this.logger.warn(
          `[portfolio-digest] failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (recipients.length > 0) {
      this.logger.log(
        `[portfolio-digest] hour=${hour} recipients=${recipients.length} sent=${sent} skipped=${skipped}`,
      );
    }
    return { sent, skipped };
  }
}

export interface PortfolioSummary {
  totalUsd: number;
  change1dUsd: number | null;
  change1dPercent: number | null;
}

/**
 * `GET /wallets/{address}/portfolio` → the three numbers the digest
 * needs. `null` when the response is the client's degraded placeholder
 * or otherwise not a portfolio.
 */
export function readPortfolio(raw: unknown): PortfolioSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const attrs = (raw as { data?: { attributes?: Record<string, unknown> } })
    .data?.attributes;
  if (!attrs) return null;
  const total = (attrs.total as { positions?: unknown } | undefined)?.positions;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  const changes = attrs.changes as
    | { absolute_1d?: unknown; percent_1d?: unknown }
    | undefined;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    totalUsd: total,
    change1dUsd: num(changes?.absolute_1d),
    change1dPercent: num(changes?.percent_1d),
  };
}

export function digestCopy(s: PortfolioSummary): {
  title: string;
  body: string;
} {
  const title = `Portfolio today: ${USD.format(s.totalUsd)}`;
  if (s.change1dUsd === null || s.change1dPercent === null) {
    return { title, body: "Here's where your wallet stands this morning." };
  }
  const up = s.change1dUsd >= 0;
  const pct = `${up ? "+" : "−"}${Math.abs(s.change1dPercent).toFixed(2)}%`;
  const abs = USD.format(Math.abs(s.change1dUsd));
  return {
    title,
    body: up
      ? `Up ${abs} (${pct}) in the last 24 hours.`
      : `Down ${abs} (${pct}) in the last 24 hours.`,
  };
}
