/**
 * Push notification service — wraps the Expo Push API via
 * `expo-server-sdk`. One backend integration covers both the
 * strategies auto-compound watcher and the UMKM USDC payout receipt
 * (umkm-usdc-payout-spec.md §6.3).
 *
 * Why Expo Push (and not direct FCM/APNs):
 *   - Mobile already obtains an Expo push token (`expo-notifications`).
 *   - Expo's push relay is free, unlimited in practice, and handles
 *     APNs cert management for us.
 *   - Migration path to native FCM is mechanical when (if) Expo's
 *     relay stops fitting our needs.
 *
 * The service is intentionally provider-agnostic at the call site:
 * callers pass `{ userId, title, body, data, channelId? }` and don't
 * need to know about Expo's request shape.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Expo,
  type ExpoPushErrorReceipt,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import { PrismaService } from "../prisma/prisma.service";

const EXPO_BATCH_SIZE = 100;

export interface SendPushArgs {
  userId: string;
  title: string;
  body: string;
  /** Custom payload — intentId, positionId, etc. */
  data?: Record<string, unknown>;
  /** Android channel id; iOS ignores. */
  channelId?: string;
  /** Optional sub-set of platforms when only one applies. */
  platforms?: ("ios" | "android" | "web")[];
}

export interface SendPushResult {
  attempted: number;
  accepted: number;
  /** Tokens removed because Expo reported `DeviceNotRegistered`. */
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
        "EXPO_ACCESS_TOKEN not set — using anonymous Expo Push relay (free, rate-limited per source IP).",
      );
    }
  }

  /**
   * Upsert a push token for a user. Idempotent — same token can be
   * re-registered safely (re-binds to current user if it moved
   * devices). Invalid Expo tokens are rejected up-front so we don't
   * persist garbage.
   */
  async registerToken(input: {
    userId: string;
    token: string;
    platform: string;
    walletAddress?: string;
  }): Promise<void> {
    if (!Expo.isExpoPushToken(input.token)) {
      this.logger.warn(
        `[registerToken] rejected: not a valid Expo push token (user=${input.userId})`,
      );
      // Curated friendly error — but the controller layer will
      // translate; here we silently bail so we never persist bad data.
      return;
    }
    const normalizedPlatform =
      input.platform === "ios" || input.platform === "android"
        ? input.platform
        : "web";

    await this.prisma.pushToken.upsert({
      where: { token: input.token },
      create: {
        token: input.token,
        userId: input.userId,
        walletAddress: input.walletAddress?.toLowerCase(),
        platform: normalizedPlatform,
      },
      update: {
        userId: input.userId,
        walletAddress: input.walletAddress?.toLowerCase(),
        platform: normalizedPlatform,
      },
    });
    this.logger.log(
      `[registerToken] upserted token for user=${input.userId} platform=${normalizedPlatform}`,
    );
  }

  /**
   * Send a push to every token belonging to a user. Best-effort:
   * delivery failures are logged but never surfaced to the caller —
   * pushes are auxiliary signal, never a transaction commit.
   *
   * Handles two failure classes:
   *   - `DeviceNotRegistered` → token uninstalled / rotated → prune.
   *   - Other transient errors → log; Expo retries internally.
   */
  async sendToUser(args: SendPushArgs): Promise<SendPushResult> {
    const tokens = await this.prisma.pushToken.findMany({
      where: {
        userId: args.userId,
        ...(args.platforms && args.platforms.length > 0
          ? { platform: { in: args.platforms } }
          : {}),
      },
    });
    if (tokens.length === 0) {
      return { attempted: 0, accepted: 0, pruned: 0 };
    }

    const messages: ExpoPushMessage[] = tokens.map((row) => ({
      to: row.token,
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
          `[sendToUser] sendPushNotificationsAsync chunk failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Prune tokens for which Expo immediately rejected with
    // `DeviceNotRegistered`. Async-receipt cleanup (the second pass
    // where you poll Expo with `getPushNotificationReceiptsAsync`)
    // is intentionally deferred to V1.1 — for nudges, ticket-level
    // pruning catches the dominant failure mode.
    const toPrune: string[] = [];
    let accepted = 0;
    tickets.forEach((ticket, i) => {
      if (ticket.status === "ok") {
        accepted += 1;
        return;
      }
      const err = (ticket as { details?: ExpoPushErrorReceipt["details"] })
        .details;
      if (err?.error === "DeviceNotRegistered") {
        const token = messages[i]?.to;
        if (typeof token === "string") toPrune.push(token);
      } else {
        this.logger.warn(
          `[sendToUser] expo ticket error: ${ticket.message ?? "unknown"} (code=${err?.error ?? "n/a"})`,
        );
      }
    });
    if (toPrune.length > 0) {
      await this.prisma.pushToken
        .deleteMany({ where: { token: { in: toPrune } } })
        .catch((pruneErr) => {
          this.logger.warn(
            `[sendToUser] prune failed: ${
              pruneErr instanceof Error ? pruneErr.message : String(pruneErr)
            }`,
          );
        });
    }

    this.logger.log(
      `[sendToUser] user=${args.userId} attempted=${messages.length} accepted=${accepted} pruned=${toPrune.length}`,
    );
    return {
      attempted: messages.length,
      accepted,
      pruned: toPrune.length,
    };
  }

  // Re-export the batch size constant for tests / observability.
  static readonly BATCH_SIZE = EXPO_BATCH_SIZE;
}
