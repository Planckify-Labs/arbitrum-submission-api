import { Module } from "@nestjs/common";
import { ExchangeRateController } from "./exchange-rate.controller";
import { ExchangeRateService } from "./exchange-rate.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [ExchangeRateController],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRateModule {}
