import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import type { Queue } from "bullmq";
import { chainFromRegistryRow } from "../external/zerion/zerion.chains";
import {
  ZerionSubscriptionsClient,
  type ZerionTxSubscription,
  ZERION_WALLETS_PER_REQUEST,
} from "../external/zerion/zerion-subscriptions.client";
import { PrismaService } from "../prisma/prisma.service";
import { ValkeyService } from "../valkey/valkey.service";
import { ZERION_WEBHOOK_PATH } from "./wallet-activity.controller";
import {
  WALLET_ACTIVITY_QUEUE,
  type WalletActivityJobData,
} from "./wallet-activity.types";

const SUBSCRIPTION_ID_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Boot reconcile waits for the queue/DB to settle before the first call. */
const BOOT_RECONCILE_DELAY_MS = 30_000;

/**
 * Keeps ONE Zerion transaction subscription equal to "every wallet that
 * can receive a push, on every chain we support that Zerion indexes".
 *
 * Wallets: the distinct addresses in `WalletPushSubscription`, plus the
 * wallet of every user who has a device registered (the two routes
 * `PushService` resolves devices through). Sui / Stellar / Solana-devnet
 * addresses are dropped — Zerion does not index them.
 *
 * Chains: every active `Blockchain` row that maps to a Zerion chain id
 * (`chainFromRegistryRow`), testnets included. Adding a chain to the
 * registry + `ZERION_CHAINS` is the whole procedure; the next reconcile
 * PATCHes the subscription.
 *
 * Nothing is done in the request path: `registerToken` enqueues a
 * `subscribe` job for its wallets, a 6-hourly `reconcile` job repairs any
 * drift (missed job, wallet removed, chain added), and both run on the
 * `wallet-activity` worker with BullMQ retries.
 *
 * The subscription is found by callback URL, so a redeploy / Redis flush
 * never creates a second one. Dashboard prerequisite: Zerion must
 * whitelist the callback host (Dashboard → Support) or the callbacks are
 * silently not delivered.
 */
@Injectable()
export class ZerionSubscriptionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ZerionSubscriptionSyncService.name);
  private readonly callbackUrl: string | null;
  private readonly enabled: boolean;
  private cachedSubscription: ZerionTxSubscription | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly valkey: ValkeyService,
    private readonly zerion: ZerionSubscriptionsClient,
    @InjectQueue(WALLET_ACTIVITY_QUEUE)
    private readonly queue: Queue<WalletActivityJobData>,
  ) {
    this.callbackUrl = resolveCallbackUrl(config);
    const flag = (config.get<string>("ZERION_WEBHOOKS_ENABLED") ?? "").trim();
    const https = !!this.callbackUrl?.startsWith("https://");
    // Auto-on for a real (https) public URL; a LAN/http dev URL has to opt
    // in explicitly, otherwise every developer's laptop would register its
    // own subscription — and its wallets — on the shared Zerion account.
    this.enabled =
      zerion.configured &&
      !!this.callbackUrl &&
      flag !== "false" &&
      (https || flag === "true");
    if (!this.enabled) {
      const why = !zerion.configured
        ? "no ZERION_API_KEY"
        : !this.callbackUrl
          ? "no PUBLIC_API_URL / ZERION_WEBHOOK_CALLBACK_URL"
          : flag === "false"
            ? "ZERION_WEBHOOKS_ENABLED=false"
            : `callback ${this.callbackUrl} is not https (set ZERION_WEBHOOKS_ENABLED=true to force)`;
      this.logger.warn(
        `[zerion-sync] disabled (${why}) — wallet-activity pushes for external transfers are off.`,
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    void this.enqueueReconcile(BOOT_RECONCILE_DELAY_MS);
  }

  /** Runs on every instance; the job id makes it one reconcile per window. */
  @Cron("15 */6 * * *", { name: "zerion-subscription-reconcile" })
  scheduledReconcile(): void {
    if (!this.enabled) return;
    void this.enqueueReconcile(0);
  }

  async enqueueReconcile(delayMs: number): Promise<void> {
    try {
      const window = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
      await this.queue.add(
        "reconcile",
        { kind: "reconcile" },
        { jobId: `reconcile:${window}`, delay: delayMs },
      );
    } catch (err) {
      this.logger.warn(
        `[zerion-sync] could not enqueue reconcile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── jobs ─────────────────────────────────────────────────────────────────

  /** `subscribe` job: add these wallets (no-op for ones already there). */
  async subscribe(wallets: string[]): Promise<void> {
    if (!this.enabled) return;
    const eligible = normalizeForZerion(wallets);
    if (eligible.length === 0) return;
    const sub = await this.ensureSubscription(eligible);
    if (!sub) return;
    await this.zerion.patchWallets(sub.id, { add: eligible });
    this.logger.log(
      `[zerion-sync] subscribed ${eligible.length} wallet(s) to ${sub.id}`,
    );
  }

  /** `reconcile` job: make Zerion's view equal ours. */
  async reconcile(): Promise<{
    added: number;
    removed: number;
    chainsUpdated: boolean;
  } | null> {
    if (!this.enabled) return null;
    const [desiredWallets, desiredChains] = await Promise.all([
      this.desiredWallets(),
      this.desiredChainIds(),
    ]);
    const sub = await this.ensureSubscription(desiredWallets, desiredChains);
    if (!sub) return null;

    let chainsUpdated = false;
    if (!sameSet(sub.chainIds, desiredChains)) {
      await this.zerion.updateChainIds(sub.id, desiredChains);
      this.cachedSubscription = { ...sub, chainIds: desiredChains };
      chainsUpdated = true;
      this.logger.log(
        `[zerion-sync] chain list → [${desiredChains.join(", ")}]`,
      );
    }

    const remote = new Set(
      (await this.zerion.listWallets(sub.id)).map((w) => w.toLowerCase()),
    );
    const desired = new Set(desiredWallets.map((w) => w.toLowerCase()));
    // Solana addresses are case-significant; compare lowercase but send the
    // original spelling.
    const add = desiredWallets.filter((w) => !remote.has(w.toLowerCase()));
    const remove = [...remote].filter((w) => !desired.has(w));
    if (add.length > 0 || remove.length > 0) {
      await this.zerion.patchWallets(sub.id, { add, remove });
    }
    this.logger.log(
      `[zerion-sync] reconciled ${sub.id}: wallets=${desiredWallets.length} added=${add.length} removed=${remove.length} chains=${desiredChains.length}${chainsUpdated ? " (updated)" : ""}`,
    );
    return { added: add.length, removed: remove.length, chainsUpdated };
  }

  // ─── desired state ────────────────────────────────────────────────────────

  async desiredChainIds(): Promise<string[]> {
    const rows = await this.prisma.blockchain.findMany({
      where: { isActive: true },
      select: { chainId: true, chainSlug: true },
    });
    const ids = new Set<string>();
    for (const row of rows) {
      const chain = chainFromRegistryRow(row);
      if (chain?.capabilities.includes("transactions")) ids.add(chain.zerionId);
    }
    return [...ids].sort();
  }

  async desiredWallets(): Promise<string[]> {
    const [subs, owners] = await Promise.all([
      this.prisma.walletPushSubscription.findMany({
        distinct: ["walletAddress"],
        select: { walletAddress: true },
      }),
      this.prisma.user.findMany({
        where: {
          walletAddress: { not: null },
          devicePushTokens: { some: {} },
        },
        select: { walletAddress: true },
      }),
    ]);
    return normalizeForZerion([
      ...subs.map((s) => s.walletAddress),
      ...owners.map((o) => o.walletAddress as string),
    ]);
  }

  // ─── subscription identity ────────────────────────────────────────────────

  /**
   * The subscription for our callback URL: memory → Valkey → Zerion's list
   * → create. Creation seeds the first 100 wallets (the API's cap per
   * request); the reconcile that follows adds the rest.
   */
  async ensureSubscription(
    seedWallets: string[] = [],
    chainIds?: string[],
  ): Promise<ZerionTxSubscription | null> {
    if (!this.enabled || !this.callbackUrl) return null;
    if (this.cachedSubscription) return this.cachedSubscription;

    const cacheKey = `zerion:txsub:${this.callbackUrl}`;
    const cachedId = await this.valkey.get<string>(cacheKey).catch(() => null);

    let found: ZerionTxSubscription | undefined;
    const all = await this.zerion.listSubscriptions();
    if (cachedId) found = all.find((s) => s.id === String(cachedId));
    if (!found) {
      found = all.find((s) => s.callbackUrl === this.callbackUrl);
    }
    if (!found) {
      const chains = chainIds ?? (await this.desiredChainIds());
      found = await this.zerion.createSubscription({
        callbackUrl: this.callbackUrl,
        addresses: seedWallets.slice(0, ZERION_WALLETS_PER_REQUEST),
        chainIds: chains,
      });
      this.logger.log(
        `[zerion-sync] created subscription ${found.id} → ${this.callbackUrl} chains=[${chains.join(", ")}]`,
      );
    }
    this.cachedSubscription = found;
    await this.valkey
      .set(cacheKey, found.id, { ttl: SUBSCRIPTION_ID_TTL_SECONDS })
      .catch(() => undefined);
    return found;
  }
}

/** `${PUBLIC_API_URL}/webhooks/zerion/transactions`, or the explicit override. */
export function resolveCallbackUrl(config: ConfigService): string | null {
  const explicit = config.get<string>("ZERION_WEBHOOK_CALLBACK_URL")?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = config.get<string>("PUBLIC_API_URL")?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${ZERION_WEBHOOK_PATH}`;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// Base58, 32–44 chars: Solana. (Stellar is base32 `G…`/56 chars, Sui is
// 0x + 64 hex — both fail this and the EVM check, which is the point.)
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The subset of our wallets Zerion can watch, in the spelling Zerion
 * expects (lowercase hex for EVM; Solana verbatim), de-duplicated.
 */
export function normalizeForZerion(wallets: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of wallets) {
    const w = raw.trim();
    if (EVM_ADDRESS.test(w)) out.add(w.toLowerCase());
    else if (SOLANA_ADDRESS.test(w)) out.add(w);
  }
  return [...out];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
