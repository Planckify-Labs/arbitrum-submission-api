import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BlockchainVerificationService } from "./blockchain-verification.service";
import { SolanaVerificationService } from "./solana-verification.service";
import { StellarVerificationService } from "./stellar-verification.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [BlockchainVerificationService, SolanaVerificationService, StellarVerificationService],
  exports: [BlockchainVerificationService, SolanaVerificationService, StellarVerificationService],
})
export class BlockchainVerificationModule {}
