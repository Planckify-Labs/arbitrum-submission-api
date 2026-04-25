import { Module } from "@nestjs/common";
import { BlockchainVerificationService } from "./blockchain-verification.service";
import { SolanaVerificationService } from "./solana-verification.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [BlockchainVerificationService, SolanaVerificationService],
  exports: [BlockchainVerificationService, SolanaVerificationService],
})
export class BlockchainVerificationModule {}
