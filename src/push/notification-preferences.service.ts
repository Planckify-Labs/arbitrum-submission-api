import type { Prisma } from "@generated/prisma";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { canonicalizeWalletAddress } from "../utils/address";
import {
  DEFAULT_CATEGORY_ENABLED,
  effectiveCategories,
  isNotificationCategory,
  type NotificationCategory,
} from "./notification-categories";

/** Any Prisma client — the caller's open transaction or the service one. */
type Db = Prisma.TransactionClient;

export interface NotificationPreferencesView {
  categories: Record<NotificationCategory, boolean>;
  defaults: Record<NotificationCategory, boolean>;
  digestHourUtc: number;
}

/**
 * Per-user notification settings. Read on every push (one indexed lookup;
 * absent row = defaults), written only from `PATCH
 * /users/me/notification-preferences`.
 *
 * Wallet-targeted pushes resolve to the wallet's own User row (every wallet
 * that has signed in has one — see auth.service.ts), so muting is per
 * wallet in practice, which is also how the app presents accounts.
 */
@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string): Promise<NotificationPreferencesView> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId },
      select: { categories: true, digestHourUtc: true },
    });
    return {
      categories: effectiveCategories(row?.categories),
      defaults: { ...DEFAULT_CATEGORY_ENABLED },
      digestHourUtc: row?.digestHourUtc ?? 2,
    };
  }

  /**
   * Merge `categories` into the stored overrides (only the keys present
   * change) and optionally move the digest hour. Returns the new effective
   * view.
   */
  async update(
    userId: string,
    patch: {
      categories?: Partial<Record<NotificationCategory, boolean>>;
      digestHourUtc?: number;
    },
  ): Promise<NotificationPreferencesView> {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId },
      select: { categories: true },
    });
    const overrides: Record<string, boolean> = {};
    if (existing?.categories && typeof existing.categories === "object") {
      for (const [k, v] of Object.entries(
        existing.categories as Record<string, unknown>,
      )) {
        if (isNotificationCategory(k) && typeof v === "boolean") {
          overrides[k] = v;
        }
      }
    }
    for (const [k, v] of Object.entries(patch.categories ?? {})) {
      if (isNotificationCategory(k) && typeof v === "boolean") {
        overrides[k] = v;
      }
    }

    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        categories: overrides,
        ...(patch.digestHourUtc !== undefined
          ? { digestHourUtc: patch.digestHourUtc }
          : {}),
      },
      update: {
        categories: overrides,
        ...(patch.digestHourUtc !== undefined
          ? { digestHourUtc: patch.digestHourUtc }
          : {}),
      },
    });
    return this.getForUser(userId);
  }

  /**
   * Is `category` on for this target? `null` category = not governed by
   * preferences (always sent). Never throws: a preferences lookup failure
   * must not swallow a payment push, so it fails open.
   */
  async isEnabled(
    target: { userId?: string; walletAddress?: string },
    category: NotificationCategory | null,
    db: Db = this.prisma,
  ): Promise<boolean> {
    if (!category) return true;
    try {
      const userId =
        target.userId ??
        (target.walletAddress
          ? (
              await db.user.findUnique({
                where: {
                  walletAddress: canonicalizeWalletAddress(
                    target.walletAddress,
                  ),
                },
                select: { id: true },
              })
            )?.id
          : undefined);
      if (!userId) return DEFAULT_CATEGORY_ENABLED[category];
      const row = await db.notificationPreference.findUnique({
        where: { userId },
        select: { categories: true },
      });
      return effectiveCategories(row?.categories)[category];
    } catch (err) {
      this.logger.warn(
        `[preferences] lookup failed for ${target.userId ?? target.walletAddress ?? "?"}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }

  /**
   * Users who opted into the daily digest and want it at this UTC hour.
   * The digest is off by default, so this is exactly the set of explicit
   * opt-ins — the JSON path filter does the work in Postgres.
   */
  async digestRecipientsForHour(
    hourUtc: number,
  ): Promise<Array<{ userId: string; walletAddress: string }>> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        digestHourUtc: hourUtc,
        categories: { path: ["portfolio_digest"], equals: true },
        user: { walletAddress: { not: null } },
      },
      select: { userId: true, user: { select: { walletAddress: true } } },
    });
    return rows
      .filter((r) => r.user.walletAddress)
      .map((r) => ({
        userId: r.userId,
        walletAddress: r.user.walletAddress as string,
      }));
  }
}
