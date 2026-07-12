import type { OnModuleInit } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { ValkeyService } from "./valkey.service";
import { VendorAPICacheService } from "./services/vendor-api-cache.service";
import { NonceCacheService } from "./services/nonce-cache.service";
import { OtpCacheService } from "./services/otp-cache.service";
import { RateLimitCacheService } from "./services/rate-limit-cache.service";
import { CacheManagerService } from "./services/cache-manager.service";
import { CacheInvalidationService } from "./services/cache-invalidation.service";
import { ProductCacheService } from "./services/product-cache.service";
import { ExchangeRateCacheService } from "./services/exchange-rate-cache.service";
import { BookingCacheService } from "./services/booking-cache.service";
import { BlockchainCacheService } from "./services/blockchain-cache.service";
import { SmartContractCacheService } from "./services/smart-contract-cache.service";
import { TokenCacheService } from "./services/token-cache.service";
import { CacheInterceptor } from "./interceptors/cache.interceptor";
import { InvalidateCacheInterceptor } from "./interceptors/invalidate-cache.interceptor";
import { CacheWarmingService } from "./services/cache-warming.service";
import { AddressBookCacheService } from "./services/address-book-cache.service";
import { PointsCacheService } from "./services/points-cache.service";

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    ValkeyService,
    VendorAPICacheService,
    NonceCacheService,
    OtpCacheService,
    RateLimitCacheService,
    CacheManagerService,
    CacheInvalidationService,
    ProductCacheService,
    ExchangeRateCacheService,
    BookingCacheService,
    BlockchainCacheService,
    SmartContractCacheService,
    TokenCacheService,
    CacheInterceptor,
    InvalidateCacheInterceptor,
    CacheWarmingService,
    AddressBookCacheService,
    PointsCacheService,
  ],
  exports: [
    ValkeyService,
    VendorAPICacheService,
    NonceCacheService,
    OtpCacheService,
    RateLimitCacheService,
    CacheManagerService,
    CacheInvalidationService,
    ProductCacheService,
    ExchangeRateCacheService,
    BookingCacheService,
    BlockchainCacheService,
    SmartContractCacheService,
    TokenCacheService,
    CacheInterceptor,
    InvalidateCacheInterceptor,
    CacheWarmingService,
    AddressBookCacheService,
    PointsCacheService,
  ],
})
export class ValkeyModule implements OnModuleInit {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheInvalidationService: CacheInvalidationService,
  ) {}

  /**
   * Register cache invalidation service with Prisma middleware on module initialization
   */
  onModuleInit() {
    this.prismaService.setCacheInvalidationService(this.cacheInvalidationService);
  }
}
