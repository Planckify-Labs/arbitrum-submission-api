import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockchainVerificationService } from '../../blockchain-verification/blockchain-verification.service';
import { NftTokenType } from '@generated/prisma';
import { readContract } from 'viem/actions';
import { addressesEqual } from '../../auth/address-compare';

interface NftVerificationJobData {
  userId: string;
}

const ERC721_OWNER_OF_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const;

const ERC1155_BALANCE_OF_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

@Processor('nft-verification', { concurrency: 3 })
export class NftVerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NftVerificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainVerification: BlockchainVerificationService,
  ) {
    super();
  }

  async process(job: Job<NftVerificationJobData>): Promise<void> {
    const { userId } = job.data;

    this.logger.log(`Verifying NFT ownership for user ${userId}`);

    const assets = await this.prisma.nftAsset.findMany({
      where: { userId, isOwned: true },
      include: { blockchain: true },
    });

    if (assets.length === 0) return;

    for (const asset of assets) {
      try {
        if (asset.blockchain.type !== "EVM" || asset.blockchain.chainId == null) {
          this.logger.debug(
            `Skipping non-EVM NFT ${asset.contractAddress}#${asset.tokenId} on ${asset.blockchain.name}`,
          );
          continue;
        }
        const client = this.blockchainVerification.getPublicClient(
          asset.blockchain.chainId,
        );
        const contractAddress = asset.contractAddress as `0x${string}`;
        const tokenId = BigInt(asset.tokenId);

        let isOwned = false;

        if (asset.tokenType === NftTokenType.ERC721) {
          const owner = await readContract(client, {
            address: contractAddress,
            abi: ERC721_OWNER_OF_ABI,
            functionName: 'ownerOf',
            args: [tokenId],
          });
          // EVM-only: viem ownerOf() returns 0x hex. NFT assets are ERC-721/1155.
          isOwned = addressesEqual(owner, asset.walletAddress);
        } else {
          const balance = await readContract(client, {
            address: contractAddress,
            abi: ERC1155_BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [asset.walletAddress as `0x${string}`, tokenId],
          });
          isOwned = balance > 0n;
        }

        await this.prisma.nftAsset.update({
          where: { id: asset.id },
          data: { isOwned, lastVerifiedAt: new Date() },
        });

        if (!isOwned) {
          this.logger.log(
            `NFT ${asset.contractAddress}#${asset.tokenId} no longer owned by ${asset.walletAddress}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to verify ownership for NFT ${asset.contractAddress}#${asset.tokenId}: ${error.message}`,
        );
        // Mark as not owned on contract error (e.g. token burned)
        await this.prisma.nftAsset.update({
          where: { id: asset.id },
          data: { isOwned: false, lastVerifiedAt: new Date() },
        });
      }
    }

    this.logger.log(`NFT ownership verification complete for user ${userId}: ${assets.length} assets checked`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`NFT verification job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`NFT verification job ${job.id} failed: ${err.message}`);
  }
}
