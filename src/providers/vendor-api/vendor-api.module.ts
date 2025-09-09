import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module";
import { ValkeyModule } from "../../valkey/valkey.module";
import { VCGamersService } from "./implementations/vcgamers/vcgamers.service";

@Module({
  imports: [ConfigModule, PrismaModule, ValkeyModule],
  providers: [VCGamersService],
  exports: [VCGamersService],
})
export class VendorAPIModule {}
