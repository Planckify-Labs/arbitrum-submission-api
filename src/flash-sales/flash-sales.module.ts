import { Module } from "@nestjs/common";
import { FlashSalesService } from "./flash-sales.service";
import { FlashSalesController } from "./flash-sales.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [FlashSalesController],
  providers: [FlashSalesService],
  exports: [FlashSalesService],
})
export class FlashSalesModule {}
