import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module";
import { ValkeyModule } from "../../valkey/valkey.module";
import { VCGamersService } from "./implementations/vcgamers/vcgamers.service";
import { VendorRegistry } from "./vendor-registry.service";

@Module({
  imports: [ConfigModule, PrismaModule, ValkeyModule],
  providers: [VCGamersService, VendorRegistry],
  exports: [VCGamersService, VendorRegistry],
})
export class VendorAPIModule {}
