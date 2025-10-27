import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyService } from "./valkey.service";
import { VendorAPICacheService } from "./services/vendor-api-cache.service";
import { NonceCacheService } from "./services/nonce-cache.service";
import { RateLimitCacheService } from "./services/rate-limit-cache.service";

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    ValkeyService,
    VendorAPICacheService,
    NonceCacheService,
    RateLimitCacheService,
  ],
  exports: [
    ValkeyService,
    VendorAPICacheService,
    NonceCacheService,
    RateLimitCacheService,
  ],
})
export class ValkeyModule {}
