import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { RedeemService } from "./redeem.service";
import { RedeemController } from "./redeem.controller";
import { RedeemProcessor } from "./processors/redeem.processor";
import { PrismaModule } from "../prisma/prisma.module";
import { VendorAPIModule } from "../providers/vendor-api/vendor-api.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { ProductsModule } from "../products/products.module";
import { PushModule } from "../push/push.module";
import { FulfilmentModule } from "../fulfilment/fulfilment.module";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "redeem-processing",
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
      },
    }),
    PrismaModule,
    VendorAPIModule,
    ValkeyModule,
    ProductsModule,
    PushModule,
    FulfilmentModule,
  ],
  controllers: [RedeemController],
  providers: [RedeemService, RedeemProcessor],
  exports: [RedeemService],
})
export class RedeemModule {}
