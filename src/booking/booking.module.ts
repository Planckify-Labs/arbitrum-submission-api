import { Module } from "@nestjs/common";
import { BookingService } from "./booking.service";
import { BookingController } from "./booking.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ConfigModule } from "@nestjs/config";
import { BlockchainsModule } from "../blockchains/blockchains.module";
import { ProductsModule } from "../products/products.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, ConfigModule, BlockchainsModule, ProductsModule, ValkeyModule],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
