import { Module } from "@nestjs/common";
import { SmartContractsService } from "./smart-contracts.service";
import { SmartContractsController } from "./smart-contracts.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [SmartContractsController],
  providers: [SmartContractsService],
  exports: [SmartContractsService],
})
export class SmartContractsModule {}
