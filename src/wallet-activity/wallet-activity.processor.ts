import { Prisma, TransactionStatus, TransactionType } from "@generated/prisma";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { type Job, UnrecoverableError } from "bullmq";
import { ZerionApiError } from "../external/zerion/zerion-subscriptions.client";
import { chainFromZerionId } from "../external/zerion/zerion.chains";
import { PrismaService } from "../prisma/prisma.service";
import { PushService, type SendPushResult } from "../push/push.service";
import { NotificationCategory } from "../push/notification-categories";
import {
  isFetchableLogoUrl,
  TokenIconService,
} from "../tokens/token-icon.service";
import { canonicalizeWalletAddress, truncateAddress } from "../utils/address";
import {
  type ActivityNotification,
  classifyActivity,
  type FungibleAmount,
  walletActivityDedupeKey,
} from "./wallet-activity.classifier";
import {
  WALLET_ACTIVITY_QUEUE,
  type WalletActivityJobData,
} from "./wallet-activity.types";
import {
  chainIdOf,
  type ZerionCallbackPayload,
  type ZerionCallbackTransaction,
} from "./zerion-callback.types";
import { ZerionSubscriptionSyncService } from "./zerion-subscription-sync.service";

type ChainRow = { id: string; name: string };
type TokenRow = {
  id: string;
  symbol: string;
  decimals: number;
  logoUrl: string | null;
};

/**
 * The `wallet-activity` worker. Three job kinds:
 *
 *   callback   — one Zerion notification → zero or more pushes. Idempotent
 *                on the notification's dedupe key (tx hash + wallet), so a
 *                duplicate delivery, a queue retry and the sender's own app
 *                recording the same transfer all collapse to one push.
 *   subscribe  — wallets a device just registered → Zerion subscription.
 *   reconcile  — periodic full diff (see ZerionSubscriptionSyncService).
 *
 * A callback may carry several transactions; each is processed on its own
 * so one bad item cannot cost the others their push.
 */
@Processor(WALLET_ACTIVITY_QUEUE, { concurrency: 5 })
export class WalletActivityProcessor extends WorkerHost {
  private readonly logger = new Logger(WalletActivityProcessor.name);
  private readonly chainCache = new Map<string, ChainRow | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly tokenIcon: TokenIconService,
    private readonly sync: ZerionSubscriptionSyncService,
  ) {
    super();
  }

  async process(job: Job<WalletActivityJobData>): Promise<unknown> {
    switch (job.data.kind) {
      case "callback":
        return this.handleCallback(job.data.payload);
      case "subscribe": {
        const { wallets } = job.data;
        return this.controlPlane(() => this.sync.subscribe(wallets));
      }
      case "reconcile":
        return this.controlPlane(() => this.sync.reconcile());
      default:
        return { ok: false };
    }
  }

  /**
   * Subscription calls: a bad API key or a rejected payload is not going
   * to get better on the fourth attempt — fail the job once, loudly,
   * instead of burning the retry budget.
   */
  private async controlPlane<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ZerionApiError && err.permanent) {
        this.logger.error(`[wallet-activity] ${err.message}`);
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }

  // ─── callback ─────────────────────────────────────────────────────────────

  async handleCallback(payload: ZerionCallbackPayload): Promise<{
    pushed: number;
    skipped: number;
  }> {
    const watched = payload.data?.attributes?.address?.trim();
    if (!watched) return { pushed: 0, skipped: 0 };
    let pushed = 0;
    let skipped = 0;
    for (const tx of payload.included ?? []) {
      try {
        const result = await this.handleTransaction(tx, watched);
        if (result) pushed += 1;
        else skipped += 1;
      } catch (err) {
        // Rethrow so BullMQ retries the whole callback: anything already
        // pushed is protected by its dedupe key, so the retry only ever
        // re-attempts what failed.
        this.logger.error(
          `[wallet-activity] tx ${tx.attributes?.hash ?? "?"} for ${truncateAddress(watched)} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }
    return { pushed, skipped };
  }

  private async handleTransaction(
    tx: ZerionCallbackTransaction,
    watched: string,
  ): Promise<boolean> {
    const hash = tx.attributes?.hash?.trim();
    if (!hash) return false;
    if (tx.attributes?.deleted) {
      return this.handleRollback(hash, watched);
    }

    const zerionChainId = chainIdOf(tx);
    const chainRow = zerionChainId ? await this.chain(zerionChainId) : null;
    const plan = classifyActivity({
      tx,
      watchedAddress: watched,
      chainName: (id) => chainRow?.name ?? humanizeChainId(id),
    });
    if (!plan) return false;

    // The app's own flows (a transfer from the send screen, a merchant
    // payment, a purchase) already own the sender's UX and record the tx in
    // history — a second "you sent" from the indexer is noise. The
    // recipient side is not affected by this: their push is deduplicated
    // by key, not skipped.
    const isSender = sameAddress(tx.attributes?.sent_from, watched);
    if (isSender && (await this.recordedByApp(hash))) {
      this.logger.debug(
        `[wallet-activity] ${hash} already recorded by the app for its sender; skipping ${plan.kind}`,
      );
      return false;
    }

    const canonical = canonicalizeWalletAddress(watched);
    const owner = await this.prisma.user.findUnique({
      where: { walletAddress: canonical },
      select: { id: true },
    });

    // Backfill the Activity row + stage the push atomically, exactly like
    // transactions.service.ts does for in-app transfers — the tap handler
    // deep-links to `transactionId`, so the row must exist when the push does.
    const { staged, token } = await this.prisma.$transaction(async (db) => {
      const backfill = await this.backfillHistory(db, {
        plan,
        hash,
        chainRow,
        ownerId: owner?.id ?? null,
        canonical,
      });
      const imageUrl = this.pushImage(backfill.token, plan.iconAsset);
      const staged = await this.pushService.stageToWallet(
        {
          walletAddress: canonical,
          title: plan.title,
          body: plan.body,
          category: plan.category,
          channelId:
            plan.category === NotificationCategory.approvals
              ? "approvals"
              : "transfers",
          source: "zerion-webhook",
          dedupeKey: plan.dedupeKey,
          imageUrl,
          data: {
            ...plan.data,
            kind: plan.kind,
            ...(backfill.transactionId
              ? { transactionId: backfill.transactionId }
              : {}),
          },
        },
        db,
      );
      return { staged, token: backfill.token };
    });

    if (staged.deduplicated) return false;
    if (token) this.tokenIcon.warm(token);
    await this.pushService.enqueue(staged);
    this.logger.log(
      `[wallet-activity] ${plan.kind} ${hash} → ${truncateAddress(canonical)} devices=${staged.attempted}${staged.muted ? " (muted)" : ""}`,
    );
    return true;
  }

  /**
   * A reorg dropped a transaction we already announced. Tell the user, and
   * fail the Activity row we backfilled for it (an in-app row is the
   * sender's own record — left alone).
   */
  private async handleRollback(
    hash: string,
    watched: string,
  ): Promise<boolean> {
    const key = walletActivityDedupeKey(hash, watched);
    const original = await this.prisma.notificationLog.findUnique({
      where: { dedupeKey: key },
      select: { id: true, title: true, data: true, source: true },
    });
    if (!original) return false;
    const data = (original.data ?? {}) as Record<string, unknown>;
    const transactionId =
      typeof data.transactionId === "string" ? data.transactionId : null;
    if (transactionId && original.source === "zerion-webhook") {
      await this.prisma.transactionHistory.updateMany({
        where: { id: transactionId, txHash: hash },
        data: { status: TransactionStatus.FAILED },
      });
    }
    const staged: SendPushResult = await this.pushService.sendToWallet({
      walletAddress: watched,
      title: "Transaction reversed",
      body: `The network dropped the transaction behind "${original.title}" (${truncateAddress(hash)}). Your balance may have changed back.`,
      category: NotificationCategory.wallet_activity,
      channelId: "transfers",
      source: "zerion-webhook",
      dedupeKey: `${key}:rollback`,
      data: {
        type: "wallet_activity",
        kind: "rollback",
        txHash: hash,
        walletAddress: watched,
        ...(transactionId ? { transactionId } : {}),
      },
    });
    return !staged.deduplicated;
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async recordedByApp(hash: string): Promise<boolean> {
    const row = await this.prisma.transactionHistory.findFirst({
      where: { txHash: hash },
      select: { id: true },
    });
    return !!row;
  }

  /**
   * Write a TRANSFER row for an external receive/send so it shows up in
   * Activity, when the wallet is one of our users and the asset is in our
   * token catalogue. Anything else (a swap, an unknown token) is push-only.
   */
  private async backfillHistory(
    db: Prisma.TransactionClient,
    input: {
      plan: ActivityNotification;
      hash: string;
      chainRow: ChainRow | null;
      ownerId: string | null;
      canonical: string;
    },
  ): Promise<{ transactionId: string | null; token: TokenRow | null }> {
    const { plan, hash, chainRow, ownerId, canonical } = input;
    const direction =
      plan.kind === "receive" ? "in" : plan.kind === "send" ? "out" : null;
    const asset: FungibleAmount | null =
      direction === "in"
        ? (plan.received[0] ?? null)
        : direction === "out"
          ? (plan.sent[0] ?? null)
          : plan.iconAsset;
    if (!asset || !chainRow) return { transactionId: null, token: null };

    const token = await this.token(db, chainRow.id, asset.contractAddress);
    if (!token || !direction || !ownerId) {
      return { transactionId: null, token };
    }

    const existing = await db.transactionHistory.findFirst({
      where: { txHash: hash, tokenId: token.id, userId: ownerId },
      select: { id: true },
    });
    if (existing) return { transactionId: existing.id, token };

    const amount = asset.amountInt
      ? new Prisma.Decimal(asset.amountInt)
      : new Prisma.Decimal(asset.amount).mul(
          new Prisma.Decimal(10).pow(token.decimals),
        );
    const row = await db.transactionHistory.create({
      data: {
        userId: ownerId,
        tokenId: token.id,
        type: TransactionType.TRANSFER,
        status: TransactionStatus.CONFIRMED,
        amount: amount.toFixed(0),
        txHash: hash,
        senderAddress:
          direction === "in" ? (asset.counterparty ?? undefined) : canonical,
        recipientAddress:
          direction === "in" ? canonical : (asset.counterparty ?? undefined),
      },
      select: { id: true },
    });
    return { transactionId: row.id, token };
  }

  private pushImage(
    token: TokenRow | null,
    asset: FungibleAmount | null,
  ): string | undefined {
    if (token) return this.tokenIcon.pushImageUrl(token);
    const url = asset?.iconUrl ?? null;
    // Zerion serves PNGs from its own CDN; anything SVG-shaped would be
    // dropped by Android's BitmapFactory anyway.
    if (isFetchableLogoUrl(url) && !/\.svg(\?|$)/i.test(url)) return url;
    return undefined;
  }

  private async chain(zerionChainId: string): Promise<ChainRow | null> {
    if (this.chainCache.has(zerionChainId)) {
      return this.chainCache.get(zerionChainId) ?? null;
    }
    const mapped = chainFromZerionId(zerionChainId);
    let row: ChainRow | null = null;
    if (mapped) {
      row = await this.prisma.blockchain.findFirst({
        where:
          mapped.chainId !== null
            ? { chainId: mapped.chainId }
            : { chainSlug: mapped.chainSlug },
        select: { id: true, name: true },
      });
    }
    this.chainCache.set(zerionChainId, row);
    return row;
  }

  private async token(
    db: Prisma.TransactionClient,
    blockchainId: string,
    contractAddress: string | null,
  ): Promise<TokenRow | null> {
    return db.token.findFirst({
      where: contractAddress
        ? {
            blockchainId,
            contractAddress: { equals: contractAddress, mode: "insensitive" },
          }
        : { blockchainId, isNativeCurrency: true },
      select: { id: true, symbol: true, decimals: true, logoUrl: true },
    });
  }
}

function sameAddress(a: string | undefined, b: string): boolean {
  return !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** "binance-smart-chain" → "Binance Smart Chain", "monad-test-v2" → "Monad Testnet". */
export function humanizeChainId(id: string): string {
  const known: Record<string, string> = {
    "binance-smart-chain": "BNB Chain",
    "monad-test-v2": "Monad Testnet",
    "ethereum-sepolia": "Ethereum Sepolia",
    "base-sepolia-test": "Base Sepolia",
    xdai: "Gnosis",
  };
  if (known[id]) return known[id];
  return id
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
