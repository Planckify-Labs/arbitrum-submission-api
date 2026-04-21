import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { BUNDLER_CLIENT, BundlerClient } from "./bundler.client";
import { UserOpController } from "./userop.controller";
import { UserOpService } from "./userop.service";

/**
 * UserOp module — owns the `POST /v1/userop/submit` bundler proxy
 * (task 37, spec §6.7).
 *
 * Dependencies:
 *   - `PrismaModule` — resolves `Blockchain.bundlerUrl` per chainId.
 *   - `ValkeyModule` — exports `RateLimitCacheService` for the 10/min
 *     per-user budget.
 *
 * `BUNDLER_CLIENT` is a module-local DI token (mirrors the
 * `CIRCLE_SETTLE_CLIENT` pattern in `PayModule`): the bundler HTTP client
 * is narrow enough to live inside the feature module, and the token
 * indirection lets tests inject a stub without mocking global `fetch`.
 */
@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [UserOpController],
  providers: [
    UserOpService,
    BundlerClient,
    { provide: BUNDLER_CLIENT, useClass: BundlerClient },
  ],
  exports: [UserOpService],
})
export class UserOpModule {}
