import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import type { ZerionSubscriptionsClient } from "../external/zerion/zerion-subscriptions.client";
import type { PrismaService } from "../prisma/prisma.service";
import type { ValkeyService } from "../valkey/valkey.service";
import type { WalletActivityJobData } from "./wallet-activity.types";
import {
  normalizeForZerion,
  resolveCallbackUrl,
  ZerionSubscriptionSyncService,
} from "./zerion-subscription-sync.service";

const CALLBACK = "https://api.takumipay.xyz/webhooks/zerion/transactions";

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((k: string) => values[k]),
  } as unknown as ConfigService;
}

function harness(opts: {
  env?: Record<string, string | undefined>;
  blockchains?: Array<{ chainId: number | null; chainSlug: string | null }>;
  subscriptions?: Array<{ walletAddress: string }>;
  owners?: Array<{ walletAddress: string }>;
  remote?: Array<{ id: string; callbackUrl: string; chainIds: string[] }>;
  remoteWallets?: string[];
  cachedId?: string | null;
}) {
  const prisma = {
    blockchain: { findMany: jest.fn(async () => opts.blockchains ?? []) },
    walletPushSubscription: {
      findMany: jest.fn(async () => opts.subscriptions ?? []),
    },
    user: { findMany: jest.fn(async () => opts.owners ?? []) },
  };
  const valkey = {
    get: jest.fn(async () => opts.cachedId ?? null),
    set: jest.fn(async () => true),
  };
  const zerion = {
    configured: true,
    listSubscriptions: jest.fn(async () => opts.remote ?? []),
    createSubscription: jest.fn(
      async (input: { callbackUrl: string; chainIds: string[] }) => ({
        id: "sub_new",
        callbackUrl: input.callbackUrl,
        chainIds: input.chainIds,
      }),
    ),
    listWallets: jest.fn(async () => opts.remoteWallets ?? []),
    patchWallets: jest.fn(async () => undefined),
    updateChainIds: jest.fn(async () => undefined),
  };
  const queue = { add: jest.fn(async () => ({})) };
  const service = new ZerionSubscriptionSyncService(
    config({
      PUBLIC_API_URL: "https://api.takumipay.xyz",
      ...(opts.env ?? {}),
    }),
    prisma as unknown as PrismaService,
    valkey as unknown as ValkeyService,
    zerion as unknown as ZerionSubscriptionsClient,
    queue as unknown as Queue<WalletActivityJobData>,
  );
  return { service, prisma, zerion, valkey, queue };
}

describe("normalizeForZerion", () => {
  it("keeps EVM (lowercased) and Solana (verbatim), drops Sui/Stellar/junk, de-duplicates", () => {
    expect(
      normalizeForZerion([
        "0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045",
        " 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 ",
        "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        "GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BC", // stellar
        "0x" + "ab".repeat(32), // sui
        "",
      ]),
    ).toEqual([
      "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    ]);
  });
});

describe("resolveCallbackUrl", () => {
  it("derives from PUBLIC_API_URL, prefers the explicit override, null when neither", () => {
    expect(
      resolveCallbackUrl(config({ PUBLIC_API_URL: "https://x.io/" })),
    ).toBe("https://x.io/webhooks/zerion/transactions");
    expect(
      resolveCallbackUrl(
        config({
          PUBLIC_API_URL: "https://x.io",
          ZERION_WEBHOOK_CALLBACK_URL: "https://hooks.x.io/z/",
        }),
      ),
    ).toBe("https://hooks.x.io/z");
    expect(resolveCallbackUrl(config({}))).toBeNull();
  });
});

describe("ZerionSubscriptionSyncService.desiredChainIds", () => {
  it("is every active registry chain Zerion indexes — testnets included, Sui/Stellar/devnet out", async () => {
    const { service } = harness({
      blockchains: [
        { chainId: 1, chainSlug: null },
        { chainId: 143, chainSlug: null }, // Monad
        { chainId: 10143, chainSlug: null }, // Monad testnet
        { chainId: 11155111, chainSlug: null }, // Sepolia
        { chainId: 421614, chainSlug: null }, // Arbitrum Sepolia — not on Zerion
        { chainId: null, chainSlug: "solana-mainnet" },
        { chainId: null, chainSlug: "solana-devnet" },
        { chainId: null, chainSlug: "sui-mainnet" },
        { chainId: null, chainSlug: "stellar-mainnet" },
        { chainId: 5042002, chainSlug: null }, // Arc testnet
      ],
    });
    expect(await service.desiredChainIds()).toEqual([
      "ethereum",
      "ethereum-sepolia",
      "monad",
      "monad-test-v2",
      "solana",
    ]);
  });
});

describe("ZerionSubscriptionSyncService.reconcile", () => {
  it("finds the subscription by callback URL, then adds the missing wallets, removes the stale ones and fixes the chain list", async () => {
    const { service, zerion } = harness({
      blockchains: [
        { chainId: 143, chainSlug: null },
        { chainId: 8453, chainSlug: null },
      ],
      subscriptions: [
        { walletAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
        { walletAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
        {
          walletAddress:
            "GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BC",
        },
      ],
      owners: [{ walletAddress: "0x1111111111111111111111111111111111111111" }],
      remote: [
        {
          id: "sub_other",
          callbackUrl: "https://elsewhere/hook",
          chainIds: [],
        },
        { id: "sub_ours", callbackUrl: CALLBACK, chainIds: ["monad"] },
      ],
      remoteWallets: [
        "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        "0x2222222222222222222222222222222222222222", // no longer ours
      ],
    });

    const result = await service.reconcile();

    expect(result).toEqual({ added: 2, removed: 1, chainsUpdated: true });
    expect(zerion.createSubscription).not.toHaveBeenCalled();
    expect(zerion.updateChainIds).toHaveBeenCalledWith("sub_ours", [
      "base",
      "monad",
    ]);
    expect(zerion.patchWallets).toHaveBeenCalledWith("sub_ours", {
      add: [
        "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        "0x1111111111111111111111111111111111111111",
      ],
      remove: ["0x2222222222222222222222222222222222222222"],
    });
  });

  it("creates the subscription with the desired chains when none exists for our callback", async () => {
    const { service, zerion, valkey } = harness({
      blockchains: [{ chainId: 143, chainSlug: null }],
      subscriptions: [
        { walletAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      ],
      remote: [],
      remoteWallets: ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
    });
    const result = await service.reconcile();
    expect(zerion.createSubscription).toHaveBeenCalledWith({
      callbackUrl: CALLBACK,
      addresses: ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
      chainIds: ["monad"],
    });
    expect(result).toEqual({ added: 0, removed: 0, chainsUpdated: false });
    expect(zerion.patchWallets).not.toHaveBeenCalled();
    expect(valkey.set).toHaveBeenCalledWith(
      `zerion:txsub:${CALLBACK}`,
      "sub_new",
      expect.anything(),
    );
  });

  it("is a no-op when disabled (no callback URL / flag off)", async () => {
    const off = harness({ env: { ZERION_WEBHOOKS_ENABLED: "false" } });
    expect(off.service.isEnabled).toBe(false);
    expect(await off.service.reconcile()).toBeNull();
    await off.service.subscribe(["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"]);
    expect(off.zerion.patchWallets).not.toHaveBeenCalled();

    const noUrl = harness({ env: { PUBLIC_API_URL: undefined } });
    expect(noUrl.service.isEnabled).toBe(false);

    // A LAN dev URL is off unless forced — no accidental subscriptions.
    const lan = harness({
      env: { PUBLIC_API_URL: "http://192.168.1.10:4000" },
    });
    expect(lan.service.isEnabled).toBe(false);
    const forced = harness({
      env: {
        PUBLIC_API_URL: "http://192.168.1.10:4000",
        ZERION_WEBHOOKS_ENABLED: "true",
      },
    });
    expect(forced.service.isEnabled).toBe(true);
  });

  it("subscribe adds only Zerion-eligible wallets, in Zerion's spelling", async () => {
    const { service, zerion } = harness({
      remote: [{ id: "sub_ours", callbackUrl: CALLBACK, chainIds: ["monad"] }],
    });
    await service.subscribe([
      "0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045",
      "GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BC",
    ]);
    expect(zerion.patchWallets).toHaveBeenCalledWith("sub_ours", {
      add: ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
    });
  });
});
