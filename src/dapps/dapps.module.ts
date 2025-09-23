import { Module } from "@nestjs/common";
import { DappsService } from "./dapps.service";
import { DappsController } from "./dapps.controller";
import { DappCategoriesService } from "./dapp-categories.service";
import { DappCategoriesController } from "./dapp-categories.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [DappsController, DappCategoriesController],
  providers: [DappsService, DappCategoriesService],
  exports: [DappsService, DappCategoriesService],
})
export class DappsModule {}
