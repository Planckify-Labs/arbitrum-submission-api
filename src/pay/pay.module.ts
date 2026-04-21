import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BlockchainVerificationModule } from "../blockchain-verification/blockchain-verification.module";
import { PayoutModule } from "../payout/payout.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { X402Module } from "../x402/x402.module";
import {
  CIRCLE_SETTLE_CLIENT,
  CircleSettleClient,
} from "./circle-settle.client";
import {
  CIRCLE_SETTLE_SVM_CLIENT,
  CircleSettleSvmClient,
} from "./circle-settle-svm.client";
import { IntentsController } from "./intents.controller";
import { IntentsService } from "./intents.service";

/**
 * Pay module — owns the `POST /v1/pay/intents` endpoint family (task 23),
 * the polling `GET /v1/pay/intents/:id` (task 25), and the Nanopay submit
 * proxy `POST /v1/pay/intents/:id/nanopay` (task 24).
 *
 * Depends on:
 *   - PrismaModule  → `payment_intents`, `merchants`, `exchange_rates`,
 *                     `nanopay_submissions` persistence.
 *   - ValkeyModule  → idempotency cache.
 *   - X402Module    → Circle Gateway EIP-712 domain (cached at boot).
 *
 * `CIRCLE_SETTLE_CLIENT` is module-local (not a separate module) because
 * it's a narrow HTTP client only this module consumes. Replicating the
 * `X402_HTTP_CLIENT` token pattern keeps tests able to inject a stub
 * without mocking global `fetch`.
 *
 * `PAYOUT_PROVIDER` is provided by `PayoutModule` (task 29). We import it
 * via `forwardRef` because `PayoutModule` in turn imports the
 * `PAYOUT_PROVIDER` token constant declared in this file. The forwardRef
 * is a type-only cycle — the runtime binding is a string constant, so the
 * JS resolution order is stable. `submitNanopay` still consumes the token
 * with `@Optional()` so the module stays bootable if PayoutModule is
 * stripped in a test rig.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ValkeyModule,
    X402Module,
    // Task 38 (`POST /v1/pay/intents/:id/deposit-receipt`): we do a
    // lightweight on-chain verification of the deposit tx via the
    // shared viem public clients owned by this module. The injected
    // `BlockchainVerificationService` is `@Optional()` inside
    // `IntentsService` so unit tests can build the service without it.
    BlockchainVerificationModule,
    forwardRef(() => PayoutModule),
  ],
  controllers: [IntentsController],
  providers: [
    IntentsService,
    CircleSettleClient,
    { provide: CIRCLE_SETTLE_CLIENT, useClass: CircleSettleClient },
    // Solana x402 facilitator client (task 43 / spec §5.2.1). The client
    // gracefully no-ops when `CIRCLE_X402_SVM_FACILITATOR_URL` is blank, so
    // pre-M6 deployments can mount this module with the SVM rail simply
    // unavailable (service throws `SVM_FACILITATOR_NOT_CONFIGURED` on
    // invocation; create-intent rejects SVM with the same code).
    CircleSettleSvmClient,
    { provide: CIRCLE_SETTLE_SVM_CLIENT, useClass: CircleSettleSvmClient },
  ],
  exports: [IntentsService],
})
export class PayModule {}
