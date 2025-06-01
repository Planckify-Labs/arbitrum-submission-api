import { Module } from "@nestjs/common";
import { SmartContractsService } from "./smart-contracts.service";
import { SmartContractsController } from "./smart-contracts.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [SmartContractsController],
  providers: [SmartContractsService],
  exports: [SmartContractsService],
})
export class SmartContractsModule {}
