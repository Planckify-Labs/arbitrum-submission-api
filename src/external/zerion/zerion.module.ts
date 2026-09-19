import { Module } from "@nestjs/common";
import { ValkeyModule } from "../../valkey/valkey.module";
import { ZerionSubscriptionsClient } from "./zerion-subscriptions.client";
import { ZerionClient } from "./zerion.client";

/**
 * Shared Zerion access. Both `StrategiesModule` (position reconciliation) and
 * `PortfolioModule` (the read layer the app calls) depend on the same client
 * instance, so the daily budget counter and the response cache are shared
 * rather than duplicated per consumer.
 */
@Module({
  imports: [ValkeyModule],
  providers: [ZerionClient, ZerionSubscriptionsClient],
  exports: [ZerionClient, ZerionSubscriptionsClient],
})
export class ZerionModule {}
