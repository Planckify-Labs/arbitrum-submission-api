import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BlockchainVerificationModule } from "../blockchain-verification/blockchain-verification.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { X402Module } from "../x402/x402.module";
import { BlockchainsController } from "./blockchains.controller";
import { BlockchainsService } from "./blockchains.service";

@Module({
  imports: [
    PrismaModule,
    ValkeyModule,
    ConfigModule,
    X402Module,
    BlockchainVerificationModule,
  ],
  controllers: [BlockchainsController],
  providers: [BlockchainsService],
  exports: [BlockchainsService],
})
export class BlockchainsModule {}
