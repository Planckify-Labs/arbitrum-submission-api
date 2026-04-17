import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { readContract } from 'viem/actions';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainVerificationService } from '../blockchain-verification/blockchain-verification.service';
import { AddNftDto } from './dto/add-nft.dto';
import { NftTokenType } from '@generated/prisma';

const ERC721_ABI = [
  {
    name: 'supportsInterface',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

const ERC1155_ABI = [
  {
    name: 'supportsInterface',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ type: 'bool' }],
  },
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
  {
    name: 'uri',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
] as const;

const IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs/';

@Injectable()
export class NftService {
  private readonly logger = new Logger(NftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainVerification: BlockchainVerificationService,
    @InjectQueue('nft-verification') private readonly nftVerificationQueue: Queue,
  ) {}

  async addNftAsset(userId: string, walletAddress: string, dto: AddNftDto) {
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: dto.blockchainId },
    });
    if (!blockchain) {
      throw new BadRequestException(`Unknown blockchainId: ${dto.blockchainId}`);
    }
    if (!blockchain.isEVM || blockchain.chainId == null) {
      throw new BadRequestException(
        `NFT verification currently supports EVM chains only (blockchain: ${blockchain.name})`,
      );
    }

    const client = this.blockchainVerification.getPublicClient(blockchain.chainId);
    const contractAddress = dto.contractAddress.toLowerCase() as `0x${string}`;
    const walletAddr = walletAddress.toLowerCase() as `0x${string}`;
    const tokenId = BigInt(dto.tokenId);

    // Detect ERC-1155 vs ERC-721
    let tokenType: NftTokenType = NftTokenType.ERC721;
    try {
      const isERC1155 = await readContract(client, {
        address: contractAddress,
        abi: ERC1155_ABI,
        functionName: 'supportsInterface',
        args: ['0xd9b67a26'],
      });
      if (isERC1155) tokenType = NftTokenType.ERC1155;
    } catch {
      // Fallback to ERC-721
    }

    // Verify ownership on-chain
    if (tokenType === NftTokenType.ERC721) {
      let owner: string;
      try {
        owner = await readContract(client, {
          address: contractAddress,
          abi: ERC721_ABI,
          functionName: 'ownerOf',
          args: [tokenId],
        });
      } catch {
        throw new BadRequestException(
          'Token does not exist or contract is not a valid ERC-721',
        );
      }
      if (owner.toLowerCase() !== walletAddr) {
        throw new BadRequestException('Wallet does not own this NFT');
      }
    } else {
      let balance: bigint;
      try {
        balance = await readContract(client, {
          address: contractAddress,
          abi: ERC1155_ABI,
          functionName: 'balanceOf',
          args: [walletAddr, tokenId],
        });
      } catch {
        throw new BadRequestException(
          'Token does not exist or contract is not a valid ERC-1155',
        );
      }
      if (balance === 0n) {
        throw new BadRequestException('Wallet does not own this NFT');
      }
    }

    // Resolve tokenURI + metadata
    let tokenUri: string | null = null;
    let name: string | null = null;
    let description: string | null = null;
    let imageUrl: string | null = null;
    let attributes: unknown = null;

    try {
      if (tokenType === NftTokenType.ERC721) {
        tokenUri = await readContract(client, {
          address: contractAddress,
          abi: ERC721_ABI,
          functionName: 'tokenURI',
          args: [tokenId],
        });
      } else {
        const uriTemplate = await readContract(client, {
          address: contractAddress,
          abi: ERC1155_ABI,
          functionName: 'uri',
          args: [tokenId],
        });
        // ERC-1155 {id} substitution: 64-char zero-padded hex
        tokenUri = uriTemplate.replace(
          '{id}',
          tokenId.toString(16).padStart(64, '0'),
        );
      }

      if (tokenUri) {
        const metadata = await this.resolveMetadata(tokenUri);
        if (metadata) {
          name = metadata.name ?? null;
          description = metadata.description ?? null;
          imageUrl = metadata.image ? this.resolveIpfsUrl(metadata.image) : null;
          attributes = metadata.attributes ?? null;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch metadata for ${contractAddress}#${dto.tokenId}: ${error.message}`,
      );
    }

    // Fallback name: contract name or token ID
    if (!name) {
      try {
        name = await readContract(client, {
          address: contractAddress,
          abi: ERC721_ABI,
          functionName: 'name',
        });
        name = `${name} #${dto.tokenId}`;
      } catch {
        name = `NFT #${dto.tokenId}`;
      }
    }

    return this.prisma.nftAsset.upsert({
      where: {
        walletAddress_contractAddress_tokenId_blockchainId: {
          walletAddress: walletAddr,
          contractAddress,
          tokenId: dto.tokenId,
          blockchainId: dto.blockchainId,
        },
      },
      create: {
        userId,
        walletAddress: walletAddr,
        contractAddress,
        tokenId: dto.tokenId,
        blockchainId: dto.blockchainId,
        tokenType,
        name,
        description,
        imageUrl,
        tokenUri,
        attributes: attributes as any,
        isOwned: true,
        lastVerifiedAt: new Date(),
      },
      update: {
        tokenType,
        name,
        description,
        imageUrl,
        tokenUri,
        attributes: attributes as any,
        isOwned: true,
        lastVerifiedAt: new Date(),
      },
    });
  }

  async getUserNftAssets(userId: string) {
    const assets = await this.prisma.nftAsset.findMany({
      where: { userId, isOwned: true },
      orderBy: { createdAt: 'desc' },
    });

    // Background ownership re-verification — fire and forget
    this.nftVerificationQueue
      .add('verify-nft-ownership', { userId }, { delay: 0 })
      .catch((err) =>
        this.logger.warn(`Failed to enqueue NFT verification: ${err.message}`),
      );

    return assets;
  }

  async removeNftAsset(userId: string, id: string) {
    const asset = await this.prisma.nftAsset.findFirst({
      where: { id, userId },
    });
    if (!asset) throw new NotFoundException('NFT asset not found');

    await this.prisma.nftAsset.delete({ where: { id } });
  }

  async refreshNftAsset(userId: string, id: string) {
    const asset = await this.prisma.nftAsset.findFirst({
      where: { id, userId },
    });
    if (!asset) throw new NotFoundException('NFT asset not found');

    return this.addNftAsset(userId, asset.walletAddress, {
      contractAddress: asset.contractAddress,
      tokenId: asset.tokenId,
      blockchainId: asset.blockchainId,
    });
  }

  private resolveIpfsUrl(url: string): string {
    if (url.startsWith('ipfs://')) {
      return `${IPFS_GATEWAY}${url.slice(7)}`;
    }
    return url;
  }

  private async resolveMetadata(
    tokenUri: string,
  ): Promise<Record<string, any> | null> {
    if (!tokenUri) return null;

    // Inline base64 data URI
    if (tokenUri.startsWith('data:application/json;base64,')) {
      const base64 = tokenUri.split(',')[1];
      return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
    }

    const url = this.resolveIpfsUrl(tokenUri);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return response.json();
  }
}
