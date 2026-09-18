import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import type { PushClientType } from "./dto/register-client.dto";

/** Relay message tags we turn into a visible notification (push-server spec). */
const TAG_SESSION_PROPOSE = 1100;
const TAG_SESSION_REQUEST = 1108;
const TAG_SESSION_AUTHENTICATE = 1116;

/** Body of `POST /clients/:clientId` from the relay (current + legacy fields). */
export interface RelayPushMessage {
  topic?: string;
  tag?: number;
  message?: string;
  id?: string;
  payload?: { topic?: string; flags?: number; blob?: string };
}

export interface DeliveryOutcome {
  /** Handed to the push outbox (delivery itself is verified asynchronously). */
  delivered: boolean;
  reason?: "unknown_client" | "ignored_tag" | "no_device";
}

/**
 * A relay request the wallet can act on lives for five minutes; a push
 * that Expo could not take within that window would only open the app to
 * "nothing to review", so it is dropped instead.
 */
const REQUEST_PUSH_TTL_SECONDS = 5 * 60;

/** Recent relay message ids, so a retried delivery does not double-notify. */
const RECENT_IDS_MAX = 2000;

@Injectable()
export class WalletConnectPushService {
  private readonly logger = new Logger(WalletConnectPushService.name);
  private readonly recentIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async register(input: {
    clientId: string;
    type: PushClientType;
    token: string;
    alwaysRaw: boolean;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.walletConnectPushClient.upsert({
        where: { clientId: input.clientId },
        create: {
          clientId: input.clientId,
          type: input.type,
          token: input.token,
          alwaysRaw: input.alwaysRaw,
        },
        update: {
          type: input.type,
          token: input.token,
          alwaysRaw: input.alwaysRaw,
        },
      });
      // The app registers the same Expo token with /users/me/push-token on
      // cold start; make sure the device row exists even if this arrives
      // first, so delivery (which goes through DevicePushToken) works.
      await tx.devicePushToken.upsert({
        where: { token: input.token },
        create: {
          token: input.token,
          platform: input.type.startsWith("apns") ? "ios" : "android",
        },
        update: {},
      });
    });
  }

  async unregister(clientId: string): Promise<void> {
    await this.prisma.walletConnectPushClient.deleteMany({
      where: { clientId },
    });
  }

  /**
   * The relay could not deliver over the socket: notify the device so the
   * user opens the wallet, which reconnects and receives the request.
   * The message stays encrypted and unread here; only `tag` decides the
   * copy, and only the tags that need a human get a notification.
   */
  async deliver(
    clientId: string,
    msg: RelayPushMessage,
  ): Promise<DeliveryOutcome> {
    const id =
      msg.id ??
      (msg.topic && msg.message
        ? `${msg.topic}:${msg.message.slice(0, 32)}`
        : null);
    if (id) {
      if (this.recentIds.has(id)) return { delivered: true };
      this.remember(id);
    }
    const copy = notificationCopy(msg.tag);
    if (!copy) return { delivered: false, reason: "ignored_tag" };

    const client = await this.prisma.walletConnectPushClient.findUnique({
      where: { clientId },
    });
    if (!client) return { delivered: false, reason: "unknown_client" };

    const result = await this.push.sendToTokens([client.token], {
      title: copy.title,
      body: copy.body,
      source: "walletconnect-push",
      channelId: "dapp-requests",
      ttlSeconds: REQUEST_PUSH_TTL_SECONDS,
      data: {
        type: "wc-push",
        topic: msg.topic ?? msg.payload?.topic ?? null,
        tag: msg.tag ?? null,
      },
    });
    if (result.attempted === 0)
      return { delivered: false, reason: "no_device" };
    return { delivered: true };
  }

  private remember(id: string): void {
    this.recentIds.add(id);
    if (this.recentIds.size > RECENT_IDS_MAX) {
      const first = this.recentIds.values().next().value;
      if (first !== undefined) this.recentIds.delete(first);
    }
  }
}

export function notificationCopy(
  tag: number | undefined,
): { title: string; body: string } | null {
  switch (tag) {
    case TAG_SESSION_PROPOSE:
    case TAG_SESSION_AUTHENTICATE:
      return {
        title: "Connection request",
        body: "An app wants to connect to your wallet. Open TakumiPay to review.",
      };
    case TAG_SESSION_REQUEST:
      return {
        title: "Approval needed",
        body: "A connected app is waiting for you. Open TakumiPay to review.",
      };
    default:
      return null;
  }
}
