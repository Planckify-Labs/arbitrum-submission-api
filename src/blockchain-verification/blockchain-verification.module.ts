import { Module } from '@nestjs/common';
import { BlockchainVerificationService } from './blockchain-verification.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [BlockchainVerificationService],
  exports: [BlockchainVerificationService],
})
export class BlockchainVerificationModule {}
