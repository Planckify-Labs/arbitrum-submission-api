import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import type { PrismaService } from "../prisma/prisma.service";
import {
  type PushReceiptEntry,
  PushService,
  formatFiatMinor,
  formatTokenMicros,
} from "./push.service";

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
    intent?: Record<string, unknown> | null;
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
    paymentIntent: {
      findUnique: jest.fn(async () => opts.intent ?? null),
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
    // Stellar (base32) is case-significant — the lookup must use the address
    // verbatim, NOT a corrupting lowercase fold.
    expect(prisma.walletPushSubscription.findMany).toHaveBeenCalledWith({
      where: { walletAddress: "GABC123" },
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

describe("payment pushes — one per payment, amount first, money language", () => {
  const device = { id: "dev_1", token: "ExponentPushToken[abc]" };
  const monadIntent = {
    payerUserId: "user_1",
    fiatAmountMinor: 48_888,
    fiatCurrency: "IDR",
    nanopayUsdcAmountMicros: 2_966_861n,
    path: "takumipay",
    merchant: { displayName: "GTron, SELONG" },
    sourceToken: { symbol: "AUSD" },
  };

  it("settled push: 'Paid Rp 48.888' / '2.97 AUSD to GTron, SELONG. Tap for your receipt.' with the receipt deep-link", async () => {
    const { service, notificationLogCreate } = buildHarness({
      directDevices: [device],
      user: { walletAddress: "0xabc" },
      intent: monadIntent,
    });
    const spy = jest.spyOn(service, "sendToUser");

    await service.sendSettledPush("pi_1");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        title: "Paid Rp 48.888",
        body: "2.97 AUSD to GTron, SELONG. Tap for your receipt.",
        data: expect.objectContaining({ intentId: "pi_1" }),
      }),
    );
    expect(notificationLogCreate).toHaveBeenCalled();
    const sent = spy.mock.calls[0][0];
    for (const word of [
      "on-chain",
      "settled",
      "verified",
      "network",
      "chain",
    ]) {
      expect(`${sent.title} ${sent.body}`.toLowerCase()).not.toContain(word);
    }
  });

  it("settled push without a named token still leads with the fiat amount", async () => {
    const { service } = buildHarness({
      directDevices: [device],
      user: { walletAddress: "0xabc" },
      intent: { ...monadIntent, sourceToken: null },
    });
    const spy = jest.spyOn(service, "sendToUser");

    await service.sendSettledPush("pi_1");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Paid Rp 48.888",
        body: "to GTron, SELONG. Tap for your receipt.",
      }),
    );
  });

  it("paid-out push is skipped on the on-chain rail (the payer already got 'Paid') but still sent for nanopay", async () => {
    const onchain = buildHarness({
      directDevices: [device],
      user: { walletAddress: "0xabc" },
      intent: monadIntent,
    });
    const spyA = jest.spyOn(onchain.service, "sendToUser");
    await onchain.service.sendPaidOutPush("pi_1");
    expect(spyA).not.toHaveBeenCalled();

    const nanopay = buildHarness({
      directDevices: [device],
      user: { walletAddress: "0xabc" },
      intent: { ...monadIntent, path: "nanopay", sourceToken: null },
    });
    const spyB = jest.spyOn(nanopay.service, "sendToUser");
    await nanopay.service.sendPaidOutPush("pi_1");
    expect(spyB).toHaveBeenCalledTimes(1);
  });

  it("formats IDR the way the app does and token micros without chain precision noise", () => {
    expect(formatFiatMinor(48_888, "IDR")).toBe("Rp 48.888");
    expect(formatFiatMinor(1_250_000, "IDR")).toBe("Rp 1.250.000");
    expect(formatFiatMinor(1050, "PHP")).toBe("PHP 10.50");
    expect(formatTokenMicros(2_966_861n)).toBe("2.97");
    expect(formatTokenMicros(941_294n)).toBe("0.9413");
  });
});
