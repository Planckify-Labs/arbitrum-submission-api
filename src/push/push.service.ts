import type { Prisma } from "@generated/prisma";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import {
  Expo,
  type ExpoPushErrorReceipt,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import { PrismaService } from "../prisma/prisma.service";

/** One outstanding delivery to verify once Expo's receipt is ready. */
export interface PushReceiptEntry {
  ticketId: string;
  deviceId: string;
  token: string;
  notificationLogId: string;
}

export interface SendPushArgs {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Android channel id; iOS ignores. */
  channelId?: string;
  /** Recorded in NotificationLog for audit/debug. */
  source?: string;
}

export interface SendToUserArgs extends SendPushArgs {
  userId: string;
}

export interface SendToWalletArgs extends SendPushArgs {
  walletAddress: string;
}

export interface SendPushResult {
  attempted: number;
  accepted: number;
  /** Tokens removed because Expo reported DeviceNotRegistered. */
  pruned: number;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue("push-receipts")
    private readonly receiptQueue: Queue<{ entries: PushReceiptEntry[] }>,
  ) {
    const accessToken = this.configService.get<string>("EXPO_ACCESS_TOKEN");
    this.expo = new Expo({
      accessToken:
        accessToken && accessToken.length > 0 ? accessToken : undefined,
    });
    if (!accessToken) {
      this.logger.log(
        "EXPO_ACCESS_TOKEN not set — using anonymous Expo Push relay (rate-limited per source IP).",
      );
    }
  }

  /**
   * Register (or re-register) a device and its wallet subscriptions.
   * Idempotent — upserts the DevicePushToken, then replaces all
   * WalletPushSubscription rows for that device so the server is always
   * authoritative from the last successful call.
   *
   * `userId` is optional — the endpoint is public (API-key gated) so a
   * device can register before the user signs in, keyed only by wallet
   * address. If a userId is later presented (user signed in on a
   * subsequent call), it gets attached to the existing row; we never
   * clear an already-known userId back to null on an anonymous call.
   */
  async registerToken(input: {
    userId: string | null;
    token: string;
    platform: string;
    wallets: string[];
  }): Promise<void> {
    if (!Expo.isExpoPushToken(input.token)) {
      this.logger.warn(
        `[registerToken] rejected: not a valid Expo push token (user=${input.userId ?? "anonymous"})`,
      );
      return;
    }

    const device = await this.prisma.devicePushToken.upsert({
      where: { token: input.token },
      create: {
        token: input.token,
        userId: input.userId,
        platform: input.platform,
      },
      update: {
        ...(input.userId ? { userId: input.userId } : {}),
        platform: input.platform,
        failCount: 0,
      },
    });

    // Replace wallet subscriptions — delete then re-create in a transaction
    // so a crash mid-replace never leaves the device with a partial list.
    const unique = [...new Set(input.wallets.filter(Boolean))];
    await this.prisma.$transaction([
      this.prisma.walletPushSubscription.deleteMany({
        where: { deviceTokenId: device.id },
      }),
      ...(unique.length > 0
        ? [
            this.prisma.walletPushSubscription.createMany({
              data: unique.map((address) => ({
                deviceTokenId: device.id,
                walletAddress: address.toLowerCase(),
              })),
            }),
          ]
        : []),
    ]);

    this.logger.log(
      `[registerToken] upserted device=${device.id} user=${input.userId ?? "anonymous"} wallets=${unique.length}`,
    );
  }

  /** Send a push to every device registered to a user. */
  async sendToUser(args: SendToUserArgs): Promise<SendPushResult> {
    const devices = await this.prisma.devicePushToken.findMany({
      where: { userId: args.userId },
      select: { id: true, token: true },
    });
    return this.dispatch(devices, args, { userId: args.userId });
  }

  /** Send a push to every device subscribed to a wallet address. */
  async sendToWallet(args: SendToWalletArgs): Promise<SendPushResult> {
    const subs = await this.prisma.walletPushSubscription.findMany({
      where: { walletAddress: args.walletAddress.toLowerCase() },
      select: { deviceToken: { select: { id: true, token: true } } },
    });
    const devices = subs.map((s) => s.deviceToken);
    return this.dispatch(devices, args, { walletAddress: args.walletAddress });
  }

  /**
   * Send a PAID_OUT receipt push for a payment intent. Looks up the
   * payer and merchant, then fans out to all devices registered by
   * that user.
   */
  async sendPaidOutPush(intentId: string): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      select: {
        payerUserId: true,
        fiatAmountMinor: true,
        fiatCurrency: true,
        merchant: { select: { displayName: true } },
      },
    });
    if (!intent?.payerUserId) {
      this.logger.debug(`[sendPaidOutPush] no payer for intentId=${intentId}`);
      return;
    }
    await this.sendToUser({
      userId: intent.payerUserId,
      title: "Payment Confirmed",
      body: `Your payment to ${intent.merchant.displayName} was received.`,
      source: "payout",
      channelId: "payouts",
      data: {
        intentId,
        merchantDisplayName: intent.merchant.displayName,
        fiatAmountMinor: intent.fiatAmountMinor,
        fiatCurrency: intent.fiatCurrency,
      },
    });
  }

  // ─── internal ────────────────────────────────────────────────────────────

  private async dispatch(
    devices: { id: string; token: string }[],
    args: SendPushArgs,
    logCtx: { userId?: string; walletAddress?: string },
  ): Promise<SendPushResult> {
    if (devices.length === 0) {
      return { attempted: 0, accepted: 0, pruned: 0 };
    }

    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.token,
      sound: "default",
      title: args.title,
      body: args.body,
      data: args.data ?? {},
      channelId: args.channelId,
      priority: "high",
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of chunks) {
      const batch = await this.sendChunkWithRetry(chunk);
      if (batch) tickets.push(...batch);
    }

    const toPrune: string[] = [];
    let accepted = 0;
    // An "ok" ticket only means Expo accepted the message for delivery —
    // it is not a delivery confirmation. Real delivery errors (stale FCM
    // registration, mismatched sender ID, etc.) only surface later via
    // the receipts endpoint, so we track ticket ids here and verify them
    // asynchronously instead of trusting the ticket alone.
    const okTickets: { ticketId: string; deviceId: string; token: string }[] =
      [];

    tickets.forEach((ticket, i) => {
      if (ticket.status === "ok") {
        accepted += 1;
        const device = devices[i];
        if (device) {
          okTickets.push({
            ticketId: ticket.id,
            deviceId: device.id,
            token: device.token,
          });
        }
        return;
      }
      const details = (ticket as { details?: ExpoPushErrorReceipt["details"] })
        .details;
      if (details?.error === "DeviceNotRegistered") {
        const token = messages[i]?.to;
        if (typeof token === "string") toPrune.push(token);
      } else {
        this.logger.warn(
          `[dispatch] expo ticket error: ${ticket.message ?? "unknown"} (code=${details?.error ?? "n/a"})`,
        );
      }
    });

    // "pending" only makes sense if there's an ok ticket to eventually
    // verify — if every ticket errored out (or the send itself failed
    // after retries), we already know the outcome, no need to wait 20
    // minutes to find out what we already know.
    const notificationLog = await this.prisma
      .$transaction(async (tx) => {
        if (toPrune.length > 0) {
          await tx.devicePushToken.deleteMany({
            where: { token: { in: toPrune } },
          });
        }
        return tx.notificationLog.create({
          data: {
            userId: logCtx.userId,
            walletAddress: logCtx.walletAddress,
            title: args.title,
            body: args.body,
            data: (args.data ?? {}) as Prisma.InputJsonValue,
            source: args.source ?? "unknown",
            recipientCount: accepted,
            expoTicketIds: okTickets.map((t) => t.ticketId),
            deliveryStatus: okTickets.length > 0 ? "pending" : "undelivered",
            deliveryCheckedAt: okTickets.length > 0 ? null : new Date(),
          },
        });
      })
      .catch((err) => {
        this.logger.warn(
          `[dispatch] prune/log transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

    if (notificationLog && okTickets.length > 0) {
      const entries: PushReceiptEntry[] = okTickets.map((t) => ({
        ...t,
        notificationLogId: notificationLog.id,
      }));
      // Expo recommends waiting at least ~15 minutes before receipts are
      // queryable; 20 minutes gives margin without leaving the token's
      // delivery status unverified for too long.
      await this.receiptQueue
        .add("check-receipts", { entries }, { delay: 20 * 60 * 1000 })
        .catch((err) => {
          this.logger.warn(
            `[dispatch] failed to enqueue receipt check: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    // Update lastPushedAt for successfully reached devices
    if (accepted > 0) {
      const successfulIds = devices
        .filter((_, i) => tickets[i]?.status === "ok")
        .map((d) => d.id);
      if (successfulIds.length > 0) {
        await this.prisma.devicePushToken
          .updateMany({
            where: { id: { in: successfulIds } },
            data: { lastPushedAt: new Date() },
          })
          .catch(() => {
            // non-critical
          });
      }
    }

    this.logger.log(
      `[dispatch] source=${args.source ?? "unknown"} attempted=${messages.length} accepted=${accepted} pruned=${toPrune.length}`,
    );
    return { attempted: messages.length, accepted, pruned: toPrune.length };
  }

  /**
   * A thrown error here is a transport-level failure (network blip, Expo
   * 5xx) — distinct from a ticket coming back with an error status, which
   * is a per-message rejection handled by the caller. Without a retry, a
   * single flaky request silently drops the notification with nothing but
   * a log line to show for it. Returns null (not an empty array) after
   * exhausting retries so the caller can tell "nothing sent" apart from
   * "sent, zero accepted".
   */
  private async sendChunkWithRetry(
    chunk: ExpoPushMessage[],
    attempts = 3,
  ): Promise<ExpoPushTicket[] | null> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        const isLast = attempt === attempts;
        const message = err instanceof Error ? err.message : String(err);
        if (isLast) {
          this.logger.error(
            `[dispatch] sendPushNotificationsAsync failed after ${attempts} attempts: ${message}`,
          );
          return null;
        }
        this.logger.warn(
          `[dispatch] sendPushNotificationsAsync failed (attempt ${attempt}/${attempts}): ${message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
    return null;
  }

  /**
   * Verify previously-"ok" tickets against Expo's receipts endpoint. This
   * is where delivery failures actually show up (DeviceNotRegistered from
   * a stale/rotated FCM registration, MismatchSenderId, InvalidCredentials,
   * etc.) — the initial ticket only confirms Expo accepted the request,
   * never that the OS delivered it. Called from `PushReceiptProcessor`
   * on a delay so receipts have had time to populate.
   */
  async checkReceipts(entries: PushReceiptEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const byTicketId = new Map(entries.map((e) => [e.ticketId, e]));
    const ticketIds = entries.map((e) => e.ticketId);
    const chunks = this.expo.chunkPushNotificationReceiptIds(ticketIds);

    const toPruneIds = new Set<string>();
    // A single dispatch can fan out to multiple devices, so aggregate per
    // NotificationLog row: "delivered" wins if any device got it,
    // "unregistered" only if every device came back DeviceNotRegistered
    // (nothing left to retry), otherwise "undelivered".
    type Outcome = "delivered" | "unregistered" | "undelivered";
    const outcomeByLogId = new Map<string, Outcome>();
    const recordOutcome = (logId: string, outcome: Outcome) => {
      const existing = outcomeByLogId.get(logId);
      if (existing === "delivered") return;
      outcomeByLogId.set(
        logId,
        existing === undefined || existing === outcome
          ? outcome
          : "undelivered",
      );
    };

    for (const chunk of chunks) {
      let receipts: Awaited<
        ReturnType<Expo["getPushNotificationReceiptsAsync"]>
      >;
      try {
        receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
      } catch (err) {
        this.logger.warn(
          `[checkReceipts] getPushNotificationReceiptsAsync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      for (const [ticketId, receipt] of Object.entries(receipts)) {
        const entry = byTicketId.get(ticketId);
        if (!entry) continue;

        if (receipt.status === "ok") {
          recordOutcome(entry.notificationLogId, "delivered");
          continue;
        }

        const details = (receipt as ExpoPushErrorReceipt).details;
        if (details?.error === "DeviceNotRegistered") {
          toPruneIds.add(entry.deviceId);
          recordOutcome(entry.notificationLogId, "unregistered");
          continue;
        }

        // Surfaces the real reason a push silently never showed up on
        // the device — invisible from the initial "ok" ticket alone.
        this.logger.warn(
          `[checkReceipts] delivery failed for device=${entry.deviceId}: ${receipt.message ?? "unknown"} (code=${details?.error ?? "n/a"})`,
        );
        recordOutcome(entry.notificationLogId, "undelivered");
      }
    }

    if (toPruneIds.size > 0) {
      await this.prisma.devicePushToken
        .deleteMany({ where: { id: { in: [...toPruneIds] } } })
        .catch((err) => {
          this.logger.warn(
            `[checkReceipts] failed to prune stale devices: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      this.logger.log(
        `[checkReceipts] pruned ${toPruneIds.size} unregistered device(s)`,
      );
    }

    await Promise.all(
      [...outcomeByLogId.entries()].map(([logId, status]) =>
        this.prisma.notificationLog
          .update({
            where: { id: logId },
            data: { deliveryStatus: status, deliveryCheckedAt: new Date() },
          })
          .catch((err) => {
            this.logger.warn(
              `[checkReceipts] failed to update NotificationLog ${logId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
      ),
    );
  }
}
