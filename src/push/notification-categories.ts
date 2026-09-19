/**
 * Notification categories — the unit a user can mute, and the inbox's
 * filter axis. Every push carries one (`SendPushArgs.category`); a caller
 * that omits it gets the one implied by its Android `channelId`, so the
 * pre-existing call sites keep working unchanged.
 *
 * Adding a category: add it here, give it a default, and (mobile) an
 * Android channel. Nothing is persisted per category until a user flips
 * it, so a new one is governed by its code default from day one.
 */
export const NotificationCategory = {
  /** Received / sent / swapped / NFT moved — from the app and from Zerion. */
  wallet_activity: "wallet_activity",
  /** Token approvals granted to a contract. Security-relevant, but noisy
   *  for active DeFi users, so it is its own toggle. */
  approvals: "approvals",
  /** Merchant payments, purchases, bookings, merchant payouts. */
  payments: "payments",
  /** Strategy nudges: claim ready, auto-compound, recurring invest. */
  defi: "defi",
  /** Points credited / redemption outcomes. */
  points: "points",
  /** New device, and anything else about account safety. */
  security: "security",
  /** WalletConnect: connection requests, approvals awaiting the user. */
  walletconnect: "walletconnect",
  /** Daily portfolio summary. Opt-in. */
  portfolio_digest: "portfolio_digest",
  /** Product news from the team. */
  announcements: "announcements",
} as const;
export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] =
  Object.values(NotificationCategory);

export function isNotificationCategory(
  value: unknown,
): value is NotificationCategory {
  return (
    typeof value === "string" &&
    (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Default per category when the user has never touched the toggle. Only
 * the digest is opt-in: it is a scheduled summary, not news about
 * something that happened to the user's money.
 */
export const DEFAULT_CATEGORY_ENABLED: Readonly<
  Record<NotificationCategory, boolean>
> = {
  wallet_activity: true,
  approvals: true,
  payments: true,
  defi: true,
  points: true,
  security: true,
  walletconnect: true,
  portfolio_digest: false,
  announcements: true,
};

/**
 * Android channel id -> category, for call sites that predate categories.
 * The channel ids are the ones already used across the codebase.
 */
const CATEGORY_BY_CHANNEL: Readonly<Record<string, NotificationCategory>> = {
  transfers: NotificationCategory.wallet_activity,
  payouts: NotificationCategory.payments,
  strategies: NotificationCategory.defi,
  points: NotificationCategory.points,
  walletconnect: NotificationCategory.walletconnect,
  "dapp-requests": NotificationCategory.walletconnect,
  security: NotificationCategory.security,
  portfolio: NotificationCategory.portfolio_digest,
  announcements: NotificationCategory.announcements,
  approvals: NotificationCategory.approvals,
};

/** Category for a push, from the explicit arg or the channel it rides on. */
export function resolveCategory(args: {
  category?: NotificationCategory;
  channelId?: string;
}): NotificationCategory | null {
  if (args.category) return args.category;
  if (args.channelId) return CATEGORY_BY_CHANNEL[args.channelId] ?? null;
  return null;
}

/** Android channel to use when a caller gives a category but no channel. */
export function defaultChannelFor(category: NotificationCategory): string {
  switch (category) {
    case NotificationCategory.wallet_activity:
      return "transfers";
    case NotificationCategory.payments:
      return "payouts";
    case NotificationCategory.defi:
      return "strategies";
    case NotificationCategory.points:
      return "points";
    case NotificationCategory.walletconnect:
      return "dapp-requests";
    case NotificationCategory.portfolio_digest:
      return "portfolio";
    default:
      return category;
  }
}

/**
 * Effective on/off map: code defaults overlaid with the user's explicit
 * overrides. Unknown keys in `overrides` (a category that was since
 * removed) are ignored rather than surfaced.
 */
export function effectiveCategories(
  overrides: unknown,
): Record<NotificationCategory, boolean> {
  const out = { ...DEFAULT_CATEGORY_ENABLED };
  if (overrides && typeof overrides === "object") {
    for (const [key, value] of Object.entries(
      overrides as Record<string, unknown>,
    )) {
      if (isNotificationCategory(key) && typeof value === "boolean") {
        out[key] = value;
      }
    }
  }
  return out;
}
