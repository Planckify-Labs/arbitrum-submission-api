import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Expo,
  type ExpoPushErrorReceipt,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import type { Prisma } from "@generated/prisma";
import { PrismaService } from "../prisma/prisma.service";

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
  ) {
    const accessToken = this.configService.get<string>("EXPO_ACCESS_TOKEN");
    this.expo = new Expo({
      accessToken: accessToken && accessToken.length > 0 ? accessToken : undefined,
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
   */
  async registerToken(input: {
    userId: string;
    token: string;
    platform: string;
    wallets: string[];
  }): Promise<void> {
    if (!Expo.isExpoPushToken(input.token)) {
      this.logger.warn(
        `[registerToken] rejected: not a valid Expo push token (user=${input.userId})`,
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
        userId: input.userId,
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
      `[registerToken] upserted device=${device.id} user=${input.userId} wallets=${unique.length}`,
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
      try {
        const batch = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...batch);
      } catch (err) {
        this.logger.warn(
          `[dispatch] sendPushNotificationsAsync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const toPrune: string[] = [];
    const toPruneIds: string[] = [];
    let accepted = 0;

    tickets.forEach((ticket, i) => {
      if (ticket.status === "ok") {
        accepted += 1;
        return;
      }
      const details = (ticket as { details?: ExpoPushErrorReceipt["details"] }).details;
      if (details?.error === "DeviceNotRegistered") {
        const token = messages[i]?.to;
        if (typeof token === "string") {
          toPrune.push(token);
          const deviceId = devices[i]?.id;
          if (deviceId) toPruneIds.push(deviceId);
        }
      } else {
        this.logger.warn(
          `[dispatch] expo ticket error: ${ticket.message ?? "unknown"} (code=${details?.error ?? "n/a"})`,
        );
      }
    });

    await this.prisma
      .$transaction(async (tx) => {
        if (toPrune.length > 0) {
          await tx.devicePushToken.deleteMany({
            where: { token: { in: toPrune } },
          });
        }
        await tx.notificationLog.create({
          data: {
            userId: logCtx.userId,
            walletAddress: logCtx.walletAddress,
            title: args.title,
            body: args.body,
            data: (args.data ?? {}) as Prisma.InputJsonValue,
            source: args.source ?? "unknown",
            recipientCount: accepted,
          },
        });
      })
      .catch((err) => {
        this.logger.warn(
          `[dispatch] prune/log transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

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
}
