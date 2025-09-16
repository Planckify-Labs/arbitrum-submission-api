import { Module } from '@nestjs/common';
import { BlockchainVerificationService } from './blockchain-verification.service';
import { BlockchainVerificationController } from './blockchain-verification.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BlockchainVerificationController],
  providers: [BlockchainVerificationService],
  exports: [BlockchainVerificationService],
})
export class BlockchainVerificationModule {}
