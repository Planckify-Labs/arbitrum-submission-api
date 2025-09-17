import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
import { Prisma, PurchaseStatus, ReferenceIdStatus } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { ReferenceIdService } from "../reference-id/reference-id.service";
import { QueueService } from "../queue/queue.service";

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceIdService: ReferenceIdService,
    private readonly queueService: QueueService,
  ) {}

  async create(createPurchaseDto: CreatePurchaseDto) {
    const {
      refId,
      bookingId,
      walletAddress,
      networkId,
      contractAddress,
      transactionHash,
    } = createPurchaseDto;

    const existingRefId =
      await this.referenceIdService.getReferenceIdStatus(refId);

    if (existingRefId) {
      if (
        existingRefId.status === ReferenceIdStatus.COMPLETED &&
        existingRefId.metadata &&
        typeof existingRefId.metadata === "object"
      ) {
        const metadata = existingRefId.metadata as Record<string, unknown>;

        if (metadata.purchaseId && typeof metadata.purchaseId === "string") {
          const existingPurchase = await this.prisma.purchase.findUnique({
            where: { id: metadata.purchaseId },
            include: {
              productVariant: true,
            },
          });

          if (
            existingPurchase &&
            metadata.bookingId &&
            typeof metadata.bookingId === "string"
          ) {
            const productVariant = existingPurchase.productVariant as Record<
              string,
              unknown
            >;
            const { product, ...productVariantWithoutProduct } = productVariant;

            return {
              ...existingPurchase,
              bookingId: metadata.bookingId,
              productVariant: productVariantWithoutProduct,
            };
          }
        }
      }

      if (existingRefId.status === ReferenceIdStatus.PROCESSING) {
        return {
          refId,
          status: PurchaseStatus.PENDING,
          message: "Purchase is being processed in the background",
          processingStatus: "in_progress",
        };
      }

      console.log(
        `Reference ID '${refId}' is already being processed. Status: ${existingRefId.status}`,
      );
    }

    const bookingForMetadata = await this.prisma.bookingOrder.findUnique({
      where: { id: bookingId },
      include: {
        productVariant: {
          include: {
            product: true,
          },
        },
        productPrice: {
          include: {
            vendor: true,
          },
        },
      },
    });

    if (!bookingForMetadata) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    if (
      bookingForMetadata.walletAddress.toLowerCase() !==
      walletAddress.toLowerCase()
    ) {
      throw new BadRequestException(
        `Wallet address mismatch: booking belongs to ${bookingForMetadata.walletAddress}`,
      );
    }

    const payment = bookingForMetadata.payment as {
      tokenAddress: string;
      blockchainNetworkId: string;
      amount: string;
    };

    if (payment.blockchainNetworkId !== networkId) {
      throw new BadRequestException(
        `Network ID mismatch: booking uses network ${payment.blockchainNetworkId}, but ${networkId} was provided`,
      );
    }

    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: networkId },
    });

    if (!blockchain) {
      throw new NotFoundException(`Network with ID ${networkId} not found`);
    }

    if (!blockchain.isActive) {
      throw new BadRequestException(`Network ${blockchain.name} is not active`);
    }

    const smartContract = await this.prisma.smartContract.findFirst({
      where: {
        blockchainId: networkId,
        address: {
          equals: contractAddress,
          mode: "insensitive",
        },
      },
    });

    if (!smartContract) {
      throw new BadRequestException(
        `Smart contract with address ${contractAddress} not found on network ${blockchain.name}`,
      );
    }

    if (!smartContract.isActive) {
      throw new BadRequestException(
        `Smart contract ${smartContract.name} is not active on network ${blockchain.name}`,
      );
    }

    let user = await this.prisma.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          walletAddress,
          authProvider: "WALLET",
        },
      });
    }

    const token = await this.prisma.token.findUnique({
      where: {
        blockchainId_contractAddress: {
          blockchainId: networkId,
          contractAddress: payment.tokenAddress,
        },
      },
    });

    if (!token) {
      throw new BadRequestException(
        `Token with address ${payment.tokenAddress} not found on network`,
      );
    }

    try {
      await this.referenceIdService.markAsProcessing(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        stage: "queued_for_processing",
        message: "Purchase queued for background processing",
      });

      const jobId = await this.queueService.addPurchaseJob({
        refId,
        bookingId,
        walletAddress,
        networkId,
        contractAddress,
        transactionHash,
        userId: user.id,
        tokenId: token.id,
      });

      console.log(`Purchase job queued with ID: ${jobId} for refId: ${refId}`);

      return {
        refId,
        status: PurchaseStatus.PENDING,
        message: "Purchase is being processed in the background",
        processingStatus: "queued",
        jobId,
        bookingId,
        estimatedProcessingTime: "2-5 minutes",
      };
    } catch (error) {
      await this.referenceIdService.markAsFailed(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        error: error.message,
        errorType: "queue_error",
      });

      throw new BadRequestException(
        `Failed to queue purchase for processing: ${error.message}`,
      );
    }
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return await this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        transaction: true,
        productVariant: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        transaction: true,
        productVariant: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    return purchase;
  }

  async updateStatus(id: string, updatePurchaseDto: UpdatePurchaseDto) {
    await this.findOne(id);

    const updateData: Prisma.PurchaseUpdateInput = {
      status: updatePurchaseDto.status,
      vendorRefId: updatePurchaseDto.vendorRefId,
      ...(updatePurchaseDto.vendorResponse && {
        vendorResponse:
          updatePurchaseDto.vendorResponse as Prisma.InputJsonValue,
      }),
    };

    return await this.prisma.purchase.update({
      where: { id },
      data: updateData,
      include: {
        transaction: true,
        productVariant: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async getStatus(id: string) {
    const purchase = await this.findOne(id);
    return {
      id: purchase.id,
      status: purchase.status,
      vendorResponse: purchase.vendorResponse,
      vendorRefId: purchase.vendorRefId,
      updatedAt: purchase.updatedAt,
    };
  }

  async search(
    searchParams: SearchPurchaseDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const {
      userId,
      transactionId,
      productId,
      vendorId,
      tokenId,
      blockchainId,
      status,
    } = searchParams;

    return await this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        ...(transactionId && { transactionId }),
        ...(status && { status }),
        ...(productId && {
          productVariant: {
            product: {
              id: productId,
            },
          },
        }),
        ...(userId && {
          transaction: {
            userId,
          },
        }),
        ...(tokenId && {
          transaction: {
            tokenId,
          },
        }),
        ...(blockchainId && {
          transaction: {
            token: {
              blockchainId,
            },
          },
        }),
        ...(vendorId && {
          productVariant: {
            ProductPrice: {
              some: {
                vendor: {
                  id: vendorId,
                },
              },
            },
          },
        }),
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByUser(userId: string, paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transaction: {
          userId,
        },
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByToken(tokenId: string, paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    const token = await this.prisma.token.findUnique({
      where: { id: tokenId },
    });

    if (!token) {
      throw new NotFoundException(`Token with ID ${tokenId} not found`);
    }

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transaction: {
          tokenId,
        },
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByBlockchain(
    blockchainId: string,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;

    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: blockchainId },
    });

    if (!blockchain) {
      throw new NotFoundException(
        `Blockchain with ID ${blockchainId} not found`,
      );
    }

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transaction: {
          token: {
            blockchainId,
          },
        },
      },
      include: {
        transaction: {
          include: {
            token: true,
          },
        },
        productVariant: {
          include: {
            product: true,
            ProductPrice: {
              include: {
                vendor: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getReferenceIdWithPurchase(refId: string) {
    const referenceId =
      await this.referenceIdService.getReferenceIdStatus(refId);

    if (
      !referenceId ||
      !referenceId.metadata ||
      typeof referenceId.metadata !== "object"
    ) {
      return null;
    }

    const metadata = referenceId.metadata as Record<string, unknown>;

    if (!metadata.purchaseId || typeof metadata.purchaseId !== "string") {
      return null;
    }

    const purchase = await this.prisma.purchase.findUnique({
      where: { id: metadata.purchaseId },
      include: {
        productVariant: true,
      },
    });

    if (
      !purchase ||
      !metadata.bookingId ||
      typeof metadata.bookingId !== "string"
    ) {
      return null;
    }

    return {
      purchase,
      bookingId: metadata.bookingId,
      status: referenceId.status,
    };
  }
}
