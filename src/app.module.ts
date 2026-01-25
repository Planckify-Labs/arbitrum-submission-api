import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
import { BookingModule } from "./booking/booking.module";
import { ExchangeRateModule } from "./exchange-rate/exchange-rate.module";
import { VendorAPIModule } from "./providers/vendor-api/vendor-api.module";
import { AuthModule } from "./auth/auth.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { ValkeyModule } from "./valkey/valkey.module";
import { QueueModule } from "./queue/queue.module";
import { DappsModule } from "./dapps/dapps.module";
import { AddressBookModule } from "./address-book/address-book.module";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { ApiKeyGuard } from "./auth/guards/api-key.guard";
import { CacheInterceptor } from "./valkey/interceptors/cache.interceptor";
import { InvalidateCacheInterceptor } from "./valkey/interceptors/invalidate-cache.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
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
    BookingModule,
    ExchangeRateModule,
    VendorAPIModule,
    AuthModule,
    ApiKeysModule,
    ValkeyModule,
    QueueModule,
    DappsModule,
    AddressBookModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: InvalidateCacheInterceptor,
    },
  ],
})
export class AppModule {}
