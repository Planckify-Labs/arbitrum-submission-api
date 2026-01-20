import { Module } from "@nestjs/common";
import { ExchangeRateController } from "./exchange-rate.controller";
import { ExchangeRateService } from "./exchange-rate.service";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [ExchangeRateController],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRateModule {}
