import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
// `PAYOUT_PROVIDER` is a plain string constant declared in
// `pay/intents.service.ts` (task 24). We import it by reference rather
// than re-declaring it so the token stays canonical. Importing only a
// value from the `pay` module (not the module class itself) avoids a
// hard circular import — `PayModule` imports `PayoutModule` via
// `forwardRef` to bind `IntentsService`'s optional injection.
import { PAYOUT_PROVIDER } from "../pay/intents.service";
import { PayoutService } from "./payout.service";
import { PAYOUT_PROVIDER_XENDIT } from "./payout-provider.port";
import { XenditPayoutProvider } from "./providers/xendit-payout.provider";
import { WebhookController } from "./webhook.controller";

/**
 * Payout module — owns the `PayoutProvider` port and its concrete
 * adapters. Consumed by task 24's `/nanopay` submit proxy as a
 * fire-and-forget after the Circle settle 200 OK (§6.4).
 *
 * Adding a new provider (Flip / Paymongo / etc.) is:
 *   1. Drop a new adapter under `providers/`.
 *   2. Bind a new token (`PAYOUT_PROVIDER_FLIP`) here.
 *   3. Add a case arm to `PayoutService.resolveProvider`.
 * No other files change — the space-docking promise of §6.4.
 *
 * Wiring `PAYOUT_PROVIDER` here (task 24's soft-link token) makes
 * `IntentsService.kickPayout` resolve to `PayoutService.trigger(intentId)`
 * automatically once this module is imported in `AppModule` — the sole
 * integration seam called out in task 29 §5.
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [WebhookController],
  providers: [
    XenditPayoutProvider,
    {
      provide: PAYOUT_PROVIDER_XENDIT,
      useExisting: XenditPayoutProvider,
    },
    PayoutService,
    {
      provide: PAYOUT_PROVIDER,
      useExisting: PayoutService,
    },
  ],
  exports: [PayoutService, PAYOUT_PROVIDER],
})
export class PayoutModule {}
