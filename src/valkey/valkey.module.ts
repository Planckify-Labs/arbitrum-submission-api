import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ValkeyService } from './valkey.service';
import { VendorAPICacheService } from './services/vendor-api-cache.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [ValkeyService, VendorAPICacheService],
  exports: [ValkeyService, VendorAPICacheService],
})
export class ValkeyModule {}
