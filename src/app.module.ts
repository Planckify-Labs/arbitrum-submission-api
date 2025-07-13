import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductsModule } from "./products/products.module";
import { UsersModule } from "./users/users.module";
import { VendorsModule } from "./vendors/vendors.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { TokensModule } from "./tokens/tokens.module";
import { RegionsModule } from "./regions/regions.module";
import { BlockchainsModule } from "./blockchains/blockchains.module";
import { SmartContractsModule } from "./smart-contracts/smart-contracts.module";
import { PurchasesModule } from "./purchases/purchases.module";
import { ApiLogsModule } from "./api-logs/api-logs.module";
import { BookingModule } from "./booking/booking.module";
import { ExchangeRateModule } from "./exchange-rate/exchange-rate.module";
import { VendorAPIModule } from "./providers/vendor-api/vendor-api.module";

@Module({
  imports: [
    PrismaModule,
    ProductsModule,
    UsersModule,
    VendorsModule,
    TransactionsModule,
    TokensModule,
    RegionsModule,
    BlockchainsModule,
    SmartContractsModule,
    PurchasesModule,
    ApiLogsModule,
    BookingModule,
    ExchangeRateModule,
    VendorAPIModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
