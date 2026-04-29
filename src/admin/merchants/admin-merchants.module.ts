import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AdminMerchantsController } from "./admin-merchants.controller";
import { AdminMerchantsService } from "./admin-merchants.service";

@Module({
  imports: [PrismaModule],
  controllers: [AdminMerchantsController],
  providers: [AdminMerchantsService],
  exports: [AdminMerchantsService],
})
export class AdminMerchantsModule {}
