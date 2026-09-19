import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { FulfilmentModule } from "../../fulfilment/fulfilment.module";
import { PointsModule } from "../../points/points.module";
import { DeliveryModule } from "../../delivery/delivery.module";
import { AdminFulfilmentController } from "./admin-fulfilment.controller";
import { AdminFulfilmentService } from "./admin-fulfilment.service";

@Module({
  imports: [PrismaModule, FulfilmentModule, PointsModule, DeliveryModule],
  controllers: [AdminFulfilmentController],
  providers: [AdminFulfilmentService],
})
export class AdminFulfilmentModule {}
