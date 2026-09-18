import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PushOutboxSweeper } from "./push-outbox-sweeper.service";
import { PushDispatchProcessor } from "./processors/push-dispatch.processor";
import { PushReceiptProcessor } from "./processors/push-receipt.processor";
import { PushController } from "./push.controller";
import {
  PUSH_DISPATCH_QUEUE,
  PUSH_RECEIPTS_QUEUE,
  PushService,
} from "./push.service";

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      {
        // The outbox drain. Eight attempts on a 3 s exponential backoff
        // (3+6+12+…+192 s ≈ 6.4 min) ride out an Expo incident or a
        // MessageRateExceeded burst; anything longer is picked up by
        // PushOutboxSweeper once the row has sat untouched for 15 min.
        name: PUSH_DISPATCH_QUEUE,
        defaultJobOptions: {
          removeOnComplete: { age: 3600, count: 5000 },
          removeOnFail: { age: 86400, count: 1000 },
          attempts: 8,
          backoff: { type: "exponential", delay: 3000 },
        },
      },
      {
        name: PUSH_RECEIPTS_QUEUE,
        defaultJobOptions: {
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400, count: 500 },
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
      },
    ),
  ],
  controllers: [PushController],
  providers: [
    PushService,
    PushDispatchProcessor,
    PushReceiptProcessor,
    PushOutboxSweeper,
  ],
  exports: [PushService],
})
export class PushModule {}
