import { Module } from "@nestjs/common";
import { DappsService } from "./dapps.service";
import { DappsController } from "./dapps.controller";
import { DappCategoriesService } from "./dapp-categories.service";
import { DappCategoriesController } from "./dapp-categories.controller";
import { DappPromotionsService } from "./dapp-promotions.service";
import { DappPromotionsController } from "./dapp-promotions.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [
    DappsController,
    DappCategoriesController,
    DappPromotionsController,
  ],
  providers: [DappsService, DappCategoriesService, DappPromotionsService],
  exports: [DappsService, DappCategoriesService, DappPromotionsService],
})
export class DappsModule {}
