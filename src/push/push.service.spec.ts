import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import type { PrismaService } from "../prisma/prisma.service";
import { type PushReceiptEntry, PushService } from "./push.service";

jest.mock("expo-server-sdk", () => {
  class FakeExpo {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(messages: unknown[]) {
      return [messages];
    }
    async sendPushNotificationsAsync(chunk: unknown[]) {
      return chunk.map((_, i) => ({ status: "ok", id: `ticket-${i}` }));
    }
    chunkPushNotificationReceiptIds(ids: string[]) {
      return [ids];
    }
    async getPushNotificationReceiptsAsync(ids: string[]) {
      return Object.fromEntries(ids.map((id) => [id, { status: "ok" }]));
    }
  }
  return { Expo: FakeExpo };
});

type Device = { id: string; token: string };

function buildHarness(
  opts: {
    directDevices?: Device[];
    user?: { walletAddress: string | null } | null;
    walletSubs?: { deviceToken: Device }[];
  } = {},
) {
  const notificationLogCreate = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "log_1",
      ...data,
    }),
  );

  const prisma = {
    devicePushToken: {
      findMany: jest.fn(async () => opts.directDevices ?? []),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    user: {
      findUnique: jest.fn(async () => opts.user ?? null),
    },
    walletPushSubscription: {
      findMany: jest.fn(async () => opts.walletSubs ?? []),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        devicePushToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
        notificationLog: { create: notificationLogCreate },
      }),
    ),
  };

  const configService = { get: jest.fn(() => undefined) };
  const queue = { add: jest.fn(async () => ({})) };

  const service = new PushService(
    prisma as unknown as PrismaService,
    configService as unknown as ConfigService,
    queue as unknown as Queue<{ entries: PushReceiptEntry[] }>,
  );

  return { service, prisma, queue, notificationLogCreate };
}

describe("PushService.sendToUser", () => {
  it("fans out to every device a wallet is registered on, across multiple physical devices", async () => {
    const { service, prisma } = buildHarness({
      directDevices: [
        { id: "device-primary", token: "ExponentPushToken[primary]" },
      ],
      user: { walletAddress: "GABC123" },
      walletSubs: [
        {
          deviceToken: {
            id: "device-tablet",
            token: "ExponentPushToken[tablet]",
          },
        },
        {
          deviceToken: {
            id: "device-secondphone",
            token: "ExponentPushToken[secondphone]",
          },
        },
      ],
    });

    const result = await service.sendToUser({
      userId: "user_1",
      title: "t",
      body: "b",
    });

    expect(result.attempted).toBe(3);
    expect(result.accepted).toBe(3);
    expect(prisma.walletPushSubscription.findMany).toHaveBeenCalledWith({
      where: { walletAddress: "gabc123" },
      select: { deviceToken: { select: { id: true, token: true } } },
    });
  });

  it("de-dupes a device found via both the direct userId match and the wallet-subscription fallback", async () => {
    const { service } = buildHarness({
      directDevices: [{ id: "device-a", token: "ExponentPushToken[a]" }],
      user: { walletAddress: "GABC123" },
      walletSubs: [
        { deviceToken: { id: "device-a", token: "ExponentPushToken[a]" } },
      ],
    });

    const result = await service.sendToUser({
      userId: "user_1",
      title: "t",
      body: "b",
    });

    expect(result.attempted).toBe(1);
  });

  it("falls back to wallet-subscription devices when DevicePushToken.userId is stale (bound to a different wallet's user)", async () => {
    // Mirrors the real bug: switching the app's active wallet doesn't
    // re-POST the push token, so DevicePushToken.userId can be pinned to
    // a different wallet's userId, leaving the direct lookup empty.
    const { service } = buildHarness({
      directDevices: [],
      user: { walletAddress: "GSECONDWALLET" },
      walletSubs: [
        { deviceToken: { id: "device-b", token: "ExponentPushToken[b]" } },
      ],
    });

    const result = await service.sendToUser({
      userId: "user_2",
      title: "t",
      body: "b",
    });

    expect(result.attempted).toBe(1);
    expect(result.accepted).toBe(1);
  });

  it("sends nothing and never throws when the user has no wallet address and no direct devices", async () => {
    const { service, prisma } = buildHarness({
      directDevices: [],
      user: { walletAddress: null },
    });

    const result = await service.sendToUser({
      userId: "user_3",
      title: "t",
      body: "b",
    });

    expect(result.attempted).toBe(0);
    expect(prisma.walletPushSubscription.findMany).not.toHaveBeenCalled();
  });
});
