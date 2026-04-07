import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { mapVendorErrorToException } from "./exceptions/vendor-api.exceptions";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
import { Prisma, PurchaseStatus, ReferenceIdStatus } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { ReferenceIdService } from "../reference-id/reference-id.service";
import { QueueService } from "../queue/queue.service";
import { VCGamersService } from "../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import { BlockchainCacheService } from "../valkey/services/blockchain-cache.service";
import { SmartContractCacheService } from "../valkey/services/smart-contract-cache.service";
import { TokenCacheService } from "../valkey/services/token-cache.service";

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceIdService: ReferenceIdService,
    private readonly queueService: QueueService,
    private readonly vcGamersService: VCGamersService,
    private readonly blockchainCache: BlockchainCacheService,
    private readonly contractCache: SmartContractCacheService,
    private readonly tokenCache: TokenCacheService,
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

    // Use cache for blockchain lookup (hot path optimization)
    const blockchain = await this.blockchainCache.getById(networkId, () =>
      this.prisma.blockchain.findUnique({
        where: { id: networkId },
      }),
    );

    if (!blockchain) {
      throw new NotFoundException(`Network with ID ${networkId} not found`);
    }

    if (!blockchain.isActive) {
      throw new BadRequestException(`Network ${blockchain.name} is not active`);
    }

    // Use cache for smart contract lookup (hot path optimization)
    const smartContract = await this.contractCache.getByBlockchainAndAddress(
      networkId,
      contractAddress,
      () =>
        this.prisma.smartContract.findFirst({
          where: {
            blockchainId: networkId,
            address: {
              equals: contractAddress,
              mode: "insensitive",
            },
          },
        }),
    );

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

    const normalizedWalletAddress = walletAddress.toLowerCase();

    let user = await this.prisma.user.findUnique({
      where: { walletAddress: normalizedWalletAddress },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          walletAddress: normalizedWalletAddress,
          authProvider: "WALLET",
        },
      });
    }

    // Use cache for token lookup (hot path optimization)
    const token = await this.tokenCache.getByBlockchainAndAddress(
      networkId,
      payment.tokenAddress,
      () =>
        this.prisma.token.findUnique({
          where: {
            blockchainId_contractAddress: {
              blockchainId: networkId,
              contractAddress: payment.tokenAddress,
            },
          },
        }),
    );

    if (!token) {
      throw new BadRequestException(
        `Token with address ${payment.tokenAddress} not found on network`,
      );
    }

    // Calculate amountInFiat based on exchange rate and product price
    const exchangeRateObj = bookingForMetadata.exchangeRate as {
      rate: number;
      toCurrency: string;
      fromCurrency: string;
    } | null;
    const rate = exchangeRateObj?.rate || 0;
    const sellPrice =
      bookingForMetadata.productPrice?.sellPrice?.toString() || "0";
    const amountInFiat =
      rate &&
      sellPrice &&
      exchangeRateObj?.toCurrency == bookingForMetadata.productPrice?.currency
        ? sellPrice
        : (Number(sellPrice) * rate).toString() || "0";

    const placeholderTransaction = await this.prisma.transactionHistory.create({
      data: {
        user: { connect: { id: user.id } },
        token: { connect: { id: token.id } },
        amount: payment.amount,
        amountInFiat: amountInFiat,
        fiatCurrency: exchangeRateObj?.toCurrency || "IDR",
        type: "PAYMENT",
        status: "PENDING",
        senderAddress: normalizedWalletAddress,
        recipientAddress: contractAddress.toLowerCase(),
        txHash: transactionHash,
      },
    });

    const purchase = await this.prisma.purchase.create({
      data: {
        transactionId: placeholderTransaction.id,
        transactionCreatedAt: placeholderTransaction.createdAt,
        productVariantId: bookingForMetadata.productVariantId,
        bookingOrderId: bookingId,
        status: PurchaseStatus.PROCESSING,
        refId,
      },
    });

    try {
      await this.referenceIdService.markAsProcessing(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        purchaseId: purchase.id,
        stage: "queued_for_processing",
        message: "Purchase created and queued for background processing",
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
        purchaseId: purchase.id,
      });

      console.log(`Purchase job queued with ID: ${jobId} for refId: ${refId}`);

      return {
        id: purchase.id,
        refId,
        status: PurchaseStatus.PROCESSING,
        message: "Purchase created and is being processed in the background",
        processingStatus: "queued",
        jobId,
        bookingId,
        estimatedProcessingTime: "2-5 minutes",
        createdAt: purchase.createdAt,
      };
    } catch (error) {
      await this.prisma.purchase.update({
        where: { id: purchase.id },
        data: { status: PurchaseStatus.FAILED },
      });

      await this.referenceIdService.markAsFailed(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        purchaseId: purchase.id,
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

  async findOne(id: string, options?: { vendorResponse?: boolean }) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        productVariant: {
          include: {
            product: true,
          },
        },
        bookingOrder: {
          select: {
            id: true,
            createdAt: true,
            customerInfo: true,
          },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${id} not found`);
    }

    // TransactionHistory is a TimescaleDB hypertable — no Prisma relation exists.
    // Fetch the linked transaction manually using the stored FK columns.
    const transaction = await this.prisma.transactionHistory.findFirst({
      where: {
        id: purchase.transactionId,
        createdAt: purchase.transactionCreatedAt,
      },
      include: {
        token: {
          include: {
            blockchain: true,
          },
        },
      },
    });

    const needsFreshStatus = this.shouldFetchFreshVendorStatus(purchase);

    const vendorStatusResponse =
      needsFreshStatus && purchase.vendorRefId
        ? await this.fetchAndUpdateVendorStatus({
            id: purchase.id,
            vendorRefId: purchase.vendorRefId,
          })
        : purchase.vendorStatusResponse;

    const voucherCode = this.extractVoucherCode(vendorStatusResponse);

    const vendorName = this.extractVendorName(vendorStatusResponse);

    if (options?.vendorResponse) {
      return {
        ...purchase,
        transaction,
        vendorName,
        voucherCode,
        lastChecked: purchase.updatedAt,
        vendorStatusResponse:
          this.extractRawVendorResponse(vendorStatusResponse),
      };
    } else {
      return {
        id: purchase.id,
        status: purchase.status,
        transactionId: purchase.transactionId,
        productVariantId: purchase.productVariantId,
        refId: purchase.refId,
        createdAt: purchase.createdAt,
        updatedAt: purchase.updatedAt,
        transaction,
        productVariant: purchase.productVariant,
        voucherCode,
        booking: purchase.bookingOrder,
      };
    }
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
        productVariant: {
          include: {
            product: true,
          },
        },
      },
    });
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

    // Purchase has no Prisma relation to TransactionHistory (hypertable).
    // Pre-fetch matching transaction IDs to filter by transaction properties.
    let filteredTransactionIds: string[] | undefined;
    if (userId || tokenId || blockchainId) {
      const txWhere: Prisma.TransactionHistoryWhereInput = {};
      if (userId) txWhere.userId = userId;
      if (tokenId) txWhere.tokenId = tokenId;
      if (blockchainId) txWhere.token = { blockchainId };

      const matchingTxs = await this.prisma.transactionHistory.findMany({
        where: txWhere,
        select: { id: true },
      });
      filteredTransactionIds = matchingTxs.map((t) => t.id);

      if (filteredTransactionIds.length === 0) return [];
    }

    return await this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        ...(transactionId && { transactionId }),
        ...(filteredTransactionIds && {
          transactionId: { in: filteredTransactionIds },
        }),
        ...(status && { status }),
        ...(productId && {
          productVariant: {
            product: {
              id: productId,
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

    // No Prisma relation from Purchase → TransactionHistory (hypertable).
    // Pre-fetch transaction IDs owned by this user.
    const userTxs = await this.prisma.transactionHistory.findMany({
      where: { userId },
      select: { id: true },
    });
    const transactionIds = userTxs.map((t) => t.id);

    if (transactionIds.length === 0) return [];

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transactionId: { in: transactionIds },
      },
      include: {
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

    // No Prisma relation from Purchase → TransactionHistory (hypertable).
    // Pre-fetch transaction IDs for this token.
    const tokenTxs = await this.prisma.transactionHistory.findMany({
      where: { tokenId },
      select: { id: true },
    });
    const transactionIds = tokenTxs.map((t) => t.id);

    if (transactionIds.length === 0) return [];

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transactionId: { in: transactionIds },
      },
      include: {
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

    // Use cache for blockchain lookup
    const blockchain = await this.blockchainCache.getById(blockchainId, () =>
      this.prisma.blockchain.findUnique({
        where: { id: blockchainId },
      }),
    );

    if (!blockchain) {
      throw new NotFoundException(
        `Blockchain with ID ${blockchainId} not found`,
      );
    }

    // No Prisma relation from Purchase → TransactionHistory (hypertable).
    // Pre-fetch transaction IDs for this blockchain.
    const blockchainTxs = await this.prisma.transactionHistory.findMany({
      where: { token: { blockchainId } },
      select: { id: true },
    });
    const transactionIds = blockchainTxs.map((t) => t.id);

    if (transactionIds.length === 0) return [];

    return this.prisma.purchase.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        transactionId: { in: transactionIds },
      },
      include: {
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

  private shouldFetchFreshVendorStatus(purchase: {
    id: string;
    vendorStatusResponse: unknown;
  }): boolean {
    const existingVendorStatus = purchase.vendorStatusResponse as {
      vendorName?: string;
      vendorStatusResponse?: { data?: { status?: 1 | 2 } };
    } | null;

    if (
      !existingVendorStatus ||
      !existingVendorStatus.vendorStatusResponse?.data
    ) {
      return true;
    }

    if (existingVendorStatus.vendorStatusResponse.data.status === 2) {
      this.logger.debug(
        `Purchase ${purchase.id} has final vendor status, using cached response`,
        {
          purchaseId: purchase.id,
          vendorStatus: existingVendorStatus.vendorStatusResponse.data.status,
        },
      );
      return false;
    }

    this.logger.debug(
      `Purchase ${purchase.id} needs fresh vendor status check`,
      {
        purchaseId: purchase.id,
        vendorStatus: existingVendorStatus.vendorStatusResponse.data.status,
      },
    );
    return true;
  }

  private async fetchAndUpdateVendorStatus(purchase: {
    id: string;
    vendorRefId: string;
  }): Promise<unknown> {
    this.logger.debug(
      `Fetching fresh vendor status for purchase ${purchase.id}`,
      { purchaseId: purchase.id, vendorRefId: purchase.vendorRefId },
    );

    try {
      const vendorStatusResponse = await this.vcGamersService.getOrderStatus(
        purchase.vendorRefId,
      );

      if (vendorStatusResponse.success && vendorStatusResponse.data) {
        const wrappedResponse = {
          vendorName: "vcGamer",
          vendorStatusResponse: vendorStatusResponse.data,
        };

        try {
          await this.prisma.purchase.update({
            where: { id: purchase.id },
            data: {
              vendorStatusResponse:
                wrappedResponse as unknown as Prisma.InputJsonValue,
            },
          });
          this.logger.debug(
            `Successfully updated vendor status for purchase ${purchase.id}`,
            {
              purchaseId: purchase.id,
              vendorStatus: vendorStatusResponse.data.data?.status,
            },
          );
        } catch (dbError) {
          this.logger.error(
            `Failed to update vendor status in database for purchase ${purchase.id} - continuing with response`,
            {
              purchaseId: purchase.id,
              error: dbError.message,
              vendorStatus: vendorStatusResponse.data.data?.status,
            },
          );
        }

        return wrappedResponse;
      } else {
        const wrappedErrorResponse = {
          vendorName: "vcGamer",
          vendorStatusResponse: vendorStatusResponse,
        };

        try {
          await this.prisma.purchase.update({
            where: { id: purchase.id },
            data: {
              vendorStatusResponse:
                wrappedErrorResponse as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (dbError) {
          this.logger.error(
            `Failed to store error vendor status response for purchase ${purchase.id}`,
            {
              purchaseId: purchase.id,
              dbError: dbError.message,
              vendorError: vendorStatusResponse.error,
            },
          );
        }

        throw mapVendorErrorToException(
          vendorStatusResponse.statusCode,
          vendorStatusResponse.message || "Vendor API error",
          vendorStatusResponse.originalError,
        );
      }
    } catch (error) {
      const wrappedErrorResponse = {
        vendorName: "vcGamer",
        vendorStatusResponse: {
          success: false,
          statusCode: 500,
          message: "Unexpected error occurred while checking order status",
          error: error.message || "Unknown error",
        },
      };

      try {
        await this.prisma.purchase.update({
          where: { id: purchase.id },
          data: {
            vendorStatusResponse: wrappedErrorResponse as Prisma.InputJsonValue,
          },
        });
      } catch (dbError) {
        this.logger.error(
          `Failed to store error vendor status response for purchase ${purchase.id}`,
          {
            purchaseId: purchase.id,
            originalError: error.message,
            dbError: dbError.message,
          },
        );
      }

      throw error;
    }
  }

  private extractVoucherCode(vendorStatusResponse: unknown): string | null {
    try {
      const response = vendorStatusResponse as {
        vendorStatusResponse?: {
          data?: { detail?: { voucher_code?: string } };
        };
      };
      return response?.vendorStatusResponse?.data?.detail?.voucher_code || null;
    } catch (error) {
      this.logger.debug("Failed to extract voucher code", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private extractVendorName(vendorStatusResponse: unknown): string | null {
    try {
      const response = vendorStatusResponse as {
        vendorName?: string;
      };
      return response?.vendorName || null;
    } catch (error) {
      this.logger.debug("Failed to extract vendor name", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private extractRawVendorResponse(vendorStatusResponse: unknown): unknown {
    try {
      const response = vendorStatusResponse as {
        vendorStatusResponse?: unknown;
      };
      return response?.vendorStatusResponse || null;
    } catch (error) {
      this.logger.debug("Failed to extract raw vendor response", {
        error: (error as Error).message,
      });
      return null;
    }
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
