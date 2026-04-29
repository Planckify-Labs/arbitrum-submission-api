import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AdminPaymentIntentsController } from "./admin-payment-intents.controller";
import { AdminPaymentIntentsService } from "./admin-payment-intents.service";

@Module({
  imports: [PrismaModule],
  controllers: [AdminPaymentIntentsController],
  providers: [AdminPaymentIntentsService],
  exports: [AdminPaymentIntentsService],
})
export class AdminPaymentIntentsModule {}
