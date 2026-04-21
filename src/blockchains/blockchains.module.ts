import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BlockchainsService } from "./blockchains.service";
import { BlockchainsController } from "./blockchains.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { X402Module } from "../x402/x402.module";

@Module({
  imports: [PrismaModule, ValkeyModule, ConfigModule, X402Module],
  controllers: [BlockchainsController],
  providers: [BlockchainsService],
  exports: [BlockchainsService],
})
export class BlockchainsModule {}
