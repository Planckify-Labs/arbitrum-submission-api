import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PushReceiptProcessor } from "./processors/push-receipt.processor";
import { PushController } from "./push.controller";
import { PushService } from "./push.service";

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: "push-receipts",
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 500 },
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    }),
  ],
  controllers: [PushController],
  providers: [PushService, PushReceiptProcessor],
  exports: [PushService],
})
export class PushModule {}
