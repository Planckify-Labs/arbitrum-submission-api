import { Module } from "@nestjs/common";
import { BlockchainsService } from "./blockchains.service";
import { BlockchainsController } from "./blockchains.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [BlockchainsController],
  providers: [BlockchainsService],
  exports: [BlockchainsService],
})
export class BlockchainsModule {}
