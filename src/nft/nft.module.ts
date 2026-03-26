import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NftController } from './nft.controller';
import { NftService } from './nft.service';
import { NftVerificationProcessor } from './processors/nft-verification.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { BlockchainVerificationModule } from '../blockchain-verification/blockchain-verification.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'nft-verification',
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
      },
    }),
    PrismaModule,
    BlockchainVerificationModule,
  ],
  controllers: [NftController],
  providers: [NftService, NftVerificationProcessor],
  exports: [NftService],
})
export class NftModule {}
