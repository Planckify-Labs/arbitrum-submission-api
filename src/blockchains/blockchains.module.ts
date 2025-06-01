import { Module } from "@nestjs/common";
import { BlockchainsService } from "./blockchains.service";
import { BlockchainsController } from "./blockchains.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [BlockchainsController],
  providers: [BlockchainsService],
  exports: [BlockchainsService],
})
export class BlockchainsModule {}
