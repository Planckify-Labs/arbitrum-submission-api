import { Module } from "@nestjs/common";
import { PurchasesService } from "./purchases.service";
import { PurchasesController } from "./purchases.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { VendorAPIModule } from "../providers/vendor-api/vendor-api.module";
import { ProductsModule } from "../products/products.module";
import { ReferenceIdModule } from "../reference-id/reference-id.module";
import { BlockchainVerificationModule } from "../blockchain-verification/blockchain-verification.module";
import { QueueModule } from "../queue/queue.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { FulfilmentModule } from "../fulfilment/fulfilment.module";

@Module({
  imports: [
    PrismaModule,
    VendorAPIModule,
    ProductsModule,
    ReferenceIdModule,
    BlockchainVerificationModule,
    QueueModule,
    ValkeyModule,
    FulfilmentModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
