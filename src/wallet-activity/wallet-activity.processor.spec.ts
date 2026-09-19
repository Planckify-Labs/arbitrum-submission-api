import { UnrecoverableError } from "bullmq";
import { getAddress } from "viem";
import { ZerionApiError } from "../external/zerion/zerion-subscriptions.client";
import type { PrismaService } from "../prisma/prisma.service";
import type { PushService, SendPushResult } from "../push/push.service";
import type { TokenIconService } from "../tokens/token-icon.service";
import { walletActivityDedupeKey } from "./wallet-activity.classifier";
import {
  humanizeChainId,
  WalletActivityProcessor,
} from "./wallet-activity.processor";
import type { ZerionCallbackPayload } from "./zerion-callback.types";
import type { ZerionSubscriptionSyncService } from "./zerion-subscription-sync.service";

// PushService pulls in expo-server-sdk (ESM); the processor only needs the
// service's type here, so stub the SDK out like push.service.spec.ts does.
jest.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken() {
      return true;
    }
  },
}));

const ME = "0x42b9df65b219b3dd36ff330a4dd8f327a6ada990";
const ME_CANONICAL = getAddress(ME);
const OTHER = "0x1234567890abcdef1234567890abcdef12345678";
const HASH = "0xabc123";
const AUSD = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

function payload(
  attrs: Record<string, unknown>,
  address = ME,
): ZerionCallbackPayload {
  return {
    data: { id: "notif_1", type: "callback", attributes: { address } },
    included: [
      {
        type: "transactions",
        id: "tx_1",
        attributes: {
          hash: HASH,
          status: "confirmed",
          sent_from: OTHER,
          sent_to: ME,
          transfers: [],
          approvals: [],
          flags: { is_trash: false },
          ...attrs,
        },
        relationships: { chain: { type: "chains", id: "monad" } },
      },
    ],
  };
}

const receiveAusd = {
  operation_type: "receive",
  transfers: [
    {
      direction: "in",
      sender: OTHER,
      recipient: ME,
      quantity: { float: 2.0909, int: "2090900", decimals: 6 },
      fungible_info: {
        symbol: "AUSD",
        name: "Agora Dollar",
        icon: { url: "https://cdn.zerion.io/ausd.png" },
        implementations: [{ chain_id: "monad", address: AUSD, decimals: 6 }],
      },
    },
  ],
};

function harness(opts: {
  owner?: { id: string } | null;
  token?: {
    id: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
  } | null;
  chain?: { id: string; name: string } | null;
  recorded?: boolean;
  existingLog?: {
    id: string;
    title: string;
    data: unknown;
    source: string;
  } | null;
  stageResult?: Partial<SendPushResult>;
}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async () => opts.owner ?? null) },
    blockchain: { findFirst: jest.fn(async () => opts.chain ?? null) },
    token: { findFirst: jest.fn(async () => opts.token ?? null) },
    transactionHistory: {
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          // `recordedByApp` asks by txHash only; the backfill asks by (hash, token, user).
          if (where.tokenId) return null;
          return opts.recorded ? { id: "hist_app" } : null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "hist_backfilled" };
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    notificationLog: {
      findUnique: jest.fn(async () => opts.existingLog ?? null),
    },
    $transaction: jest.fn(async (fn: (db: unknown) => Promise<unknown>) =>
      fn(prisma),
    ),
  };
  const staged: SendPushResult = {
    attempted: 1,
    notificationLogId: "log_1",
    ...(opts.stageResult ?? {}),
  };
  const push = {
    stageToWallet: jest.fn(async (_args: Record<string, unknown>) => staged),
    sendToWallet: jest.fn(async (_args: Record<string, unknown>) => staged),
    enqueue: jest.fn(async () => undefined),
  };
  const tokenIcon = {
    pushImageUrl: jest.fn(() => "https://api/tokens/tok_ausd/icon.png"),
    warm: jest.fn(),
  };
  const sync = { subscribe: jest.fn(), reconcile: jest.fn() };
  const processor = new WalletActivityProcessor(
    prisma as unknown as PrismaService,
    push as unknown as PushService,
    tokenIcon as unknown as TokenIconService,
    sync as unknown as ZerionSubscriptionSyncService,
  );
  return { processor, prisma, push, tokenIcon, created };
}

describe("WalletActivityProcessor.handleCallback", () => {
  it("external receive: backfills an Activity row for our user and stages the push with the shared dedupe key + our icon", async () => {
    const { processor, push, created, tokenIcon } = harness({
      owner: { id: "user_me" },
      chain: { id: "chain_monad", name: "Monad" },
      token: {
        id: "tok_ausd",
        symbol: "AUSD",
        decimals: 6,
        logoUrl: "https://x/ausd.svg",
      },
    });

    const result = await processor.handleCallback(payload(receiveAusd));

    expect(result).toEqual({ pushed: 1, skipped: 0 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: "user_me",
      tokenId: "tok_ausd",
      type: "TRANSFER",
      status: "CONFIRMED",
      amount: "2090900",
      txHash: HASH,
      senderAddress: OTHER,
      recipientAddress: ME_CANONICAL,
    });
    const args = push.stageToWallet.mock.calls[0][0];
    expect(args).toMatchObject({
      walletAddress: ME_CANONICAL,
      title: "Transfer Received",
      body: "You received 2.0909 AUSD from 0x123456...12345678 on Monad.",
      category: "wallet_activity",
      channelId: "transfers",
      source: "zerion-webhook",
      dedupeKey: walletActivityDedupeKey(HASH, ME),
      imageUrl: "https://api/tokens/tok_ausd/icon.png",
    });
    expect((args.data as Record<string, unknown>).transactionId).toBe(
      "hist_backfilled",
    );
    expect(tokenIcon.warm).toHaveBeenCalled();
    expect(push.enqueue).toHaveBeenCalledTimes(1);
  });

  it("a wallet that is not our user still gets the push (no Activity row, Zerion's PNG as icon)", async () => {
    const { processor, push, created } = harness({
      owner: null,
      chain: { id: "chain_monad", name: "Monad" },
      token: null,
    });
    await processor.handleCallback(payload(receiveAusd));
    expect(created).toHaveLength(0);
    const args = push.stageToWallet.mock.calls[0][0];
    expect(args.imageUrl).toBe("https://cdn.zerion.io/ausd.png");
    expect(
      (args.data as Record<string, unknown>).transactionId,
    ).toBeUndefined();
  });

  it("the recipient's push is deduplicated when the sender's app already staged it", async () => {
    const { processor, push } = harness({
      owner: { id: "user_me" },
      chain: { id: "chain_monad", name: "Monad" },
      token: null,
      stageResult: {
        attempted: 0,
        notificationLogId: null,
        deduplicated: true,
      },
    });
    const result = await processor.handleCallback(payload(receiveAusd));
    expect(result).toEqual({ pushed: 0, skipped: 1 });
    expect(push.enqueue).not.toHaveBeenCalled();
  });

  it("skips the sender's own 'sent' when the app already recorded the tx — the app owns that UX", async () => {
    const { processor, push } = harness({
      owner: { id: "user_me" },
      chain: { id: "chain_monad", name: "Monad" },
      recorded: true,
    });
    const result = await processor.handleCallback(
      payload({
        operation_type: "send",
        sent_from: ME,
        sent_to: OTHER,
        transfers: [
          {
            direction: "out",
            sender: ME,
            recipient: OTHER,
            quantity: { float: 5, int: "5000000", decimals: 6 },
            fungible_info: { symbol: "AUSD", implementations: [] },
          },
        ],
      }),
    );
    expect(result).toEqual({ pushed: 0, skipped: 1 });
    expect(push.stageToWallet).not.toHaveBeenCalled();
  });

  it("but an external 'sent' (MetaMask, a CEX) IS pushed and backfilled", async () => {
    const { processor, push, created } = harness({
      owner: { id: "user_me" },
      chain: { id: "chain_monad", name: "Monad" },
      token: { id: "tok_mon", symbol: "MON", decimals: 18, logoUrl: null },
      recorded: false,
    });
    await processor.handleCallback(
      payload({
        operation_type: "send",
        sent_from: ME,
        sent_to: OTHER,
        transfers: [
          {
            direction: "out",
            sender: ME,
            recipient: OTHER,
            quantity: { float: 1.5, int: "1500000000000000000", decimals: 18 },
            fungible_info: {
              symbol: "MON",
              implementations: [
                { chain_id: "monad", address: null, decimals: 18 },
              ],
            },
          },
        ],
      }),
    );
    expect(push.stageToWallet).toHaveBeenCalledTimes(1);
    expect(created[0]).toMatchObject({
      senderAddress: ME_CANONICAL,
      recipientAddress: OTHER,
      amount: "1500000000000000000",
    });
  });

  it("approvals ride the `approvals` channel/category", async () => {
    const { processor, push } = harness({
      owner: { id: "user_me" },
      chain: { id: "chain_monad", name: "Monad" },
    });
    await processor.handleCallback(
      payload({
        operation_type: "approve",
        sent_from: ME,
        sent_to: AUSD,
        approvals: [
          {
            sender: OTHER,
            quantity: { float: 1e40, int: "1".padEnd(78, "0"), decimals: 6 },
            fungible_info: { symbol: "AUSD" },
          },
        ],
      }),
    );
    const args = push.stageToWallet.mock.calls[0][0];
    expect(args.category).toBe("approvals");
    expect(args.channelId).toBe("approvals");
  });

  it("a reorg rollback tells the user, fails the backfilled row, and is keyed so it can't repeat", async () => {
    const { processor, push, prisma } = harness({
      existingLog: {
        id: "log_orig",
        title: "Transfer Received",
        data: { transactionId: "hist_backfilled" },
        source: "zerion-webhook",
      },
    });
    const result = await processor.handleCallback(
      payload({ deleted: true, transfers: undefined, status: undefined }),
    );
    expect(result).toEqual({ pushed: 1, skipped: 0 });
    expect(prisma.transactionHistory.updateMany).toHaveBeenCalledWith({
      where: { id: "hist_backfilled", txHash: HASH },
      data: { status: "FAILED" },
    });
    const args = push.sendToWallet.mock.calls[0][0];
    expect(args.title).toBe("Transaction reversed");
    expect(args.dedupeKey).toBe(
      `${walletActivityDedupeKey(HASH, ME)}:rollback`,
    );
  });

  it("a rollback for something we never announced is silent", async () => {
    const { processor, push } = harness({ existingLog: null });
    const result = await processor.handleCallback(
      payload({ deleted: true, transfers: undefined }),
    );
    expect(result).toEqual({ pushed: 0, skipped: 1 });
    expect(push.sendToWallet).not.toHaveBeenCalled();
  });

  it("a bad API key fails a subscription job once, without burning retries", async () => {
    const { processor } = harness({});
    const sync = (processor as unknown as { sync: { subscribe: jest.Mock } })
      .sync;
    sync.subscribe.mockRejectedValueOnce(
      new ZerionApiError(401, "/tx-subscriptions/", "invalid key"),
    );
    await expect(
      processor.process({
        data: { kind: "subscribe", wallets: ["0x1"] },
      } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    sync.subscribe.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      processor.process({
        data: { kind: "subscribe", wallets: ["0x1"] },
      } as never),
    ).rejects.toThrow("ECONNRESET"); // plain error → BullMQ retries
  });

  it("an unmapped chain still gets a readable name", () => {
    expect(humanizeChainId("binance-smart-chain")).toBe("BNB Chain");
    expect(humanizeChainId("monad-test-v2")).toBe("Monad Testnet");
    expect(humanizeChainId("polygon-zkevm")).toBe("Polygon Zkevm");
  });
});
