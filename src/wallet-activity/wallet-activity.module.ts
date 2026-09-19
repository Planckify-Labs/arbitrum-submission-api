import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ZerionModule } from "../external/zerion/zerion.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PushModule } from "../push/push.module";
import { TokensModule } from "../tokens/tokens.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { WalletActivityController } from "./wallet-activity.controller";
import { WalletActivityProcessor } from "./wallet-activity.processor";
import { WALLET_ACTIVITY_QUEUE } from "./wallet-activity.types";
import { ZerionSubscriptionSyncService } from "./zerion-subscription-sync.service";
import { ZerionWebhookSignatureService } from "./zerion-webhook-signature.service";

/**
 * On-chain wallet activity → push, for every wallet the app holds, on
 * every chain we support that Zerion indexes — including transfers made
 * from other wallets, swaps on third-party dapps, approvals, and failed
 * transactions, none of which the app itself can see.
 *
 *   Zerion tx-subscription ──POST──► /webhooks/zerion/transactions
 *        ▲                                      │ (RSA-verified, 200 fast)
 *        │ subscribe / reconcile                ▼
 *   ZerionSubscriptionSyncService      wallet-activity queue
 *        ▲                                      │
 *   PushService.registerToken           WalletActivityProcessor
 *                                               │ classify → backfill → stage
 *                                               ▼
 *                                        PushService outbox
 */
@Module({
  imports: [
    PrismaModule,
    ValkeyModule,
    ZerionModule,
    PushModule,
    TokensModule,
    BullModule.registerQueue({
      name: WALLET_ACTIVITY_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 5000 },
        removeOnFail: { age: 86400, count: 1000 },
        // A callback is retried on DB/Redis trouble; the classifier's dedupe
        // key makes every retry safe.
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
      },
    }),
  ],
  controllers: [WalletActivityController],
  providers: [
    WalletActivityProcessor,
    ZerionSubscriptionSyncService,
    ZerionWebhookSignatureService,
  ],
  exports: [ZerionSubscriptionSyncService],
})
export class WalletActivityModule {}
