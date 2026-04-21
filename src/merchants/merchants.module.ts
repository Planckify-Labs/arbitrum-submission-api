import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { MerchantsController } from "./merchants.controller";
import { MerchantsService } from "./merchants.service";
import { QrSigningService } from "./qr-signing.service";

/**
 * Merchants module — owns the `/v1/merchants/*` endpoint family (§6.1)
 * plus the `QrSigningService` (§4.4). Exports the services so future
 * modules (task 45 — QRIS dispute workflow) can compose them without
 * re-instantiating the private-key loader.
 *
 * `ValkeyModule` backs the `channels:<country>` cache for the public
 * `GET /v1/merchants/channels` endpoint (task 28, §6.0 filter-at-source).
 */
@Module({
  imports: [ConfigModule, PrismaModule, ValkeyModule],
  controllers: [MerchantsController],
  providers: [MerchantsService, QrSigningService],
  exports: [MerchantsService, QrSigningService],
})
export class MerchantsModule {}
