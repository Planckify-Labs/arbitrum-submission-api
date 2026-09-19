import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";
import { BlockchainVerificationService } from "../../blockchain-verification/blockchain-verification.service";
import { VCGamersService } from "../../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import { ReferenceIdService } from "../../reference-id/reference-id.service";
import { BlockchainCacheService } from "../../valkey/services/blockchain-cache.service";
import { SmartContractCacheService } from "../../valkey/services/smart-contract-cache.service";
import { TokenCacheService } from "../../valkey/services/token-cache.service";
import { addressesEqual } from "../../auth/address-compare";
import { FulfilmentService } from "../../fulfilment/fulfilment.service";
import {
  TPurchaseJobData,
  TPurchaseStatusUpdate,
} from "../interfaces/job-data.interface";
import {
  PurchaseStatus,
  TransactionType,
  TransactionStatus,
  Prisma,
} from "@generated/prisma";
import { BookingStatus } from "../../booking/enums/booking-status.enum";
import { TBookingWithRelations } from "../types/booking.types";

@Processor("purchase-processing", { concurrency: 10 })
export class PurchaseProcessor extends WorkerHost {
  private readonly logger = new Logger(PurchaseProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainVerificationService: BlockchainVerificationService,
    private readonly vcGamersService: VCGamersService,
    private readonly referenceIdService: ReferenceIdService,
    private readonly blockchainCache: BlockchainCacheService,
    private readonly contractCache: SmartContractCacheService,
    private readonly tokenCache: TokenCacheService,
    private readonly pushService: PushService,
    private readonly fulfilment: FulfilmentService,
  ) {
    super();
  }

  async process(job: Job<TPurchaseJobData>): Promise<{
    success: boolean;
    purchaseId?: string;
    transactionId?: string;
  }> {
    const {
      refId,
      bookingId,
      walletAddress,
      networkId,
      contractAddress,
      transactionHash,
      purchaseId,
    } = job.data;

    this.logger.log(`Processing purchase job ${job.id} for refId: ${refId}`);

    // What the buyer is told on failure depends on how far we got: before
    // the chain verified the payment nothing was delivered and the charge
    // is in doubt; after it, they HAVE paid and the vendor is our problem.
    let paymentVerified = false;
    let productName: string | null = null;
    // Whether `createOrder` was called at all. Decides, once retries are
    // gone, between "refund — the vendor never heard of this" and "ops —
    // an order may exist on the vendor side".
    let orderAttempted = false;

    try {
      const existingPurchase = await this.prisma.purchase.findUnique({
        where: { id: purchaseId },
      });

      if (!existingPurchase) {
        throw new Error(`Purchase with ID ${purchaseId} not found`);
      }

      await this.updatePurchaseStatus(refId, {
        refId,
        purchaseId,
        status: "processing",
        stage: "validation",
        message: "Validating booking and preparing for blockchain verification",
      });

      const booking = await this.validateAndPrepareBooking(
        bookingId,
        walletAddress,
        networkId,
        contractAddress,
      );
      productName = booking.productVariant.product.name;

      await this.prisma.purchase.update({
        where: { id: purchaseId },
        data: { status: PurchaseStatus.PENDING },
      });

      await this.updatePurchaseStatus(refId, {
        refId,
        purchaseId,
        status: "pending",
        stage: "blockchain_verification",
        message: "Verifying blockchain transaction",
      });

      if (!refId) {
        throw new Error("RefId is required for transaction verification");
      }
      if (!contractAddress) {
        throw new Error(
          "Contract address is required for transaction verification",
        );
      }

      await this.verifyBlockchainTransaction(
        transactionHash,
        walletAddress,
        contractAddress,
        booking.blockchain.chainId ?? 0,
        refId,
        contractAddress,
        booking.id,
        (
          booking.exchangeRate as { id?: number | string } | null
        )?.id?.toString() || "0",
        booking.productVariantId,
        booking.payment.amount,
        booking.blockchain.id,
      );

      paymentVerified = true;

      const transaction = await this.prisma.transactionHistory.update({
        where: {
          id_createdAt: {
            id: existingPurchase.transactionId,
            createdAt: existingPurchase.transactionCreatedAt,
          },
        },
        data: {
          status: TransactionStatus.CONFIRMED,
        },
      });

      await this.updatePurchaseStatus(refId, {
        refId,
        purchaseId,
        status: "blockchain_verified",
        stage: "blockchain_verified",
        message: "Blockchain transaction verified successfully",
      });

      if (booking.productPrice?.vendor?.name === "vcGamer") {
        const accepted = await this.processVendorOrder(
          purchaseId,
          booking as unknown as TBookingWithRelations,
          refId,
          () => {
            orderAttempted = true;
          },
        );
        if (!accepted) {
          // Definitive vendor rejection: the fulfilment leg has already
          // marked the purchase FAILED and started the refund. Nothing to
          // retry, nothing to complete.
          await this.referenceIdService.markAsFailed(refId, {
            requestType: "PURCHASE",
            walletAddress,
            bookingId,
            purchaseId,
            error: "Vendor rejected the order",
            errorType: "vendor_rejected",
          });
          return { success: false, purchaseId, transactionId: transaction.id };
        }
        // Accepted. Whether the product actually arrives is the
        // fulfilment leg's job from here — it sends the "preparing" push
        // now and "ready" only once the vendor confirms.
        await this.fulfilment.onVendorAccepted("purchase", purchaseId);
      }

      await this.prisma.bookingOrder.update({
        where: { id: bookingId },
        data: { status: BookingStatus.EXECUTED },
      });

      // Money leg done: paid, and the vendor has the order.
      await this.prisma.purchase.update({
        where: { id: purchaseId },
        data: { status: PurchaseStatus.COMPLETED },
      });

      await this.updatePurchaseStatus(refId, {
        refId,
        purchaseId,
        status: "completed",
        stage: "completed",
        message: "Purchase completed successfully",
      });

      await this.referenceIdService.markAsCompleted(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        purchaseId,
        vendorName: booking.productPrice?.vendor?.name,
        vendorId: booking.productPrice?.vendorId,
        productCode: booking.productVariant.product.code,
        productName: booking.productVariant.product.name,
        variantCode: booking.productVariant.variantCode,
        status: "completed_successfully",
      });

      this.logger.log(
        `Purchase job ${job.id} completed successfully for refId: ${refId}`,
      );

      return {
        success: true,
        purchaseId,
        transactionId: transaction.id,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Purchase job ${job.id} failed for refId: ${refId}:`,
        error,
      );

      await this.prisma.purchase.update({
        where: { id: purchaseId },
        data: { status: PurchaseStatus.FAILED },
      });

      await this.updatePurchaseStatus(refId, {
        refId,
        purchaseId,
        status: "failed",
        stage: "error",
        message: "Purchase processing failed",
        error: errorMessage,
      });

      await this.referenceIdService.markAsFailed(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        purchaseId,
        error: errorMessage,
        errorType: "purchase_processing_error",
      });

      // Only once BullMQ is out of retries — an attempt that will be
      // retried is not an outcome the buyer needs to hear about.
      const budget = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= budget) {
        if (paymentVerified) {
          // They HAVE paid. Refund if the vendor was never reached, hand
          // to ops if an order might exist over there.
          await this.fulfilment
            .onOrderRetriesExhausted("purchase", purchaseId, {
              orderAttempted,
              error: errorMessage,
            })
            .catch((err) =>
              this.logger.error(
                `[purchase] fulfilment settle failed for ${purchaseId}: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
        } else {
          this.notifyBuyer({
            walletAddress,
            purchaseId,
            bookingId,
            productName: productName ?? "your order",
            outcome: "payment_failed",
          });
        }
      }

      throw error;
    }
  }

  /** Best-effort: a push problem must never change the purchase outcome. */
  private notifyBuyer(input: {
    walletAddress: string;
    purchaseId: string;
    bookingId: string;
    productName: string;
    outcome: "payment_failed";
  }): void {
    void this.pushService.sendPurchaseOutcomePush(input).catch((err) => {
      this.logger.warn(
        `[purchase] ${input.outcome} push failed for purchase ${input.purchaseId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async validateAndPrepareBooking(
    bookingId: string,
    walletAddress: string,
    networkId: string,
    contractAddress: string,
  ) {
    const booking = await this.prisma.bookingOrder.findUnique({
      where: { id: bookingId },
      include: {
        productVariant: {
          include: { product: true },
        },
        productPrice: {
          include: { vendor: true },
        },
      },
    });

    if (!booking) {
      throw new Error(`Booking with ID ${bookingId} not found`);
    }

    if (!addressesEqual(booking.walletAddress, walletAddress)) {
      throw new Error(
        `Wallet address mismatch: booking belongs to ${booking.walletAddress}`,
      );
    }

    const payment = booking.payment as {
      tokenAddress: string;
      blockchainNetworkId: string;
      amount: string;
    };

    if (payment.blockchainNetworkId !== networkId) {
      throw new Error(
        `Network ID mismatch: booking uses network ${payment.blockchainNetworkId}, but ${networkId} was provided`,
      );
    }

    // Use cache for blockchain lookup (hot path optimization)
    const blockchain = await this.blockchainCache.getById(networkId, () =>
      this.prisma.blockchain.findUnique({
        where: { id: networkId },
      }),
    );

    if (!blockchain || !blockchain.isActive) {
      throw new Error(`Network ${blockchain?.name || networkId} is not active`);
    }

    if (blockchain.type === "EVM") {
      const smartContract = await this.contractCache.getByBlockchainAndAddress(
        networkId,
        contractAddress,
        () =>
          this.prisma.smartContract.findFirst({
            where: {
              blockchainId: networkId,
              address: { equals: contractAddress, mode: "insensitive" },
            },
          }),
      );

      if (!smartContract || !smartContract.isActive) {
        throw new Error(
          `Smart contract with address ${contractAddress} not found or not active`,
        );
      }

      return {
        ...booking,
        payment,
        blockchain,
        smartContract,
      };
    }

    return {
      ...booking,
      payment,
      blockchain,
      smartContract: null,
    };
  }

  private async validateToken(networkId: string, tokenAddress: string) {
    // Use cache for token lookup (hot path optimization)
    const token = await this.tokenCache.getByBlockchainAndAddress(
      networkId,
      tokenAddress,
      () =>
        this.prisma.token.findUnique({
          where: {
            blockchainId_contractAddress: {
              blockchainId: networkId,
              contractAddress: tokenAddress,
            },
          },
        }),
    );

    if (!token) {
      throw new Error(
        `Token with address ${tokenAddress} not found on network`,
      );
    }

    return token;
  }

  private async verifyBlockchainTransaction(
    transactionHash: string,
    expectedSender: string,
    expectedRecipient: string,
    expectedChainId: number,
    refId: string,
    contractAddress: string,
    expectedBookingId: string,
    expectedExchangeRateId: string,
    expectedProductVariantId: string,
    expectedAmount: string,
    blockchainId: string,
  ) {
    const verificationResult =
      await this.blockchainVerificationService.verifyTransaction({
        transactionHash,
        expectedSender,
        expectedRecipient,
        expectedChainId,
        minimumConfirmations: 12,
        refId,
        contractAddress,
        expectedBookingId,
        expectedExchangeRateId,
        expectedProductVariantId,
        expectedAmount,
        blockchainId,
      });

    this.logger.log(`Transaction verification successful:`, {
      hash: verificationResult.transactionHash,
      confirmations: verificationResult.confirmations,
      status: verificationResult.status,
      from: verificationResult.from,
      to: verificationResult.to,
    });

    return verificationResult;
  }

  /**
   * Place the vendor order. Returns whether it was ACCEPTED (a
   * `trx_code` exists). A definitive rejection returns false after the
   * fulfilment leg has settled it; an ambiguous failure throws so BullMQ
   * retries (VCGamers is expected to dedupe on `ref_id`).
   */
  private async processVendorOrder(
    purchaseId: string,
    booking: TBookingWithRelations,
    refId: string,
    onAttempt: () => void,
  ): Promise<boolean> {
    await this.updatePurchaseStatus(refId, {
      refId,
      purchaseId,
      status: "vendor_processing",
      stage: "vendor_api_call",
      message: "Processing vendor order",
    });

    const customerInfo = booking.customerInfo;
    if (!customerInfo) {
      throw new Error(
        `Customer information is required for ${booking.productVariant.product.name}`,
      );
    }

    const brandKey = booking.productVariant.product.code;
    const variationKey = booking.productVariant.variantCode;
    const price = Number(booking.productPrice?.priceFromVendor || 0);

    let formData: Array<{ key: string; value: string }>;
    if (Array.isArray(customerInfo)) {
      formData = customerInfo;
    } else {
      formData = Object.entries(
        customerInfo as Record<string, string | number | boolean | string[]>,
      ).map(([key, value]) => ({ key, value: String(value) }));
    }

    if (!formData.length) {
      throw new Error("Required customer information is missing");
    }

    await this.referenceIdService.markAsProcessing(refId, {
      requestType: "PURCHASE",
      walletAddress: booking.walletAddress,
      bookingId: booking.id,
      vendorName: booking.productPrice?.vendor?.name,
      vendorId: booking.productPrice?.vendorId,
      productCode: booking.productVariant.product.code,
      productName: booking.productVariant.product.name,
      variantCode: booking.productVariant.variantCode,
      vendorAction: "creating_order",
    });

    onAttempt();
    const orderResponse = await this.vcGamersService.createOrder(
      brandKey,
      variationKey,
      price,
      formData,
      refId,
    );

    const vendorRefId = orderResponse.data?.data?.trx_code;
    if (!orderResponse.success || !vendorRefId) {
      const cls = await this.fulfilment.onVendorRejected(
        "purchase",
        purchaseId,
        orderResponse,
      );
      if (cls === "definitive") return false;
      throw new Error(`Failed to process order: ${orderResponse.message}`);
    }

    const vendorResponse = orderResponse.data as unknown as Prisma.JsonValue;

    await this.prisma.purchase.update({
      where: { id: purchaseId },
      data: {
        vendorRefId,
        vendorResponse: vendorResponse as Prisma.InputJsonValue,
      },
    });
    return true;
  }

  private async updatePurchaseStatus(
    refId: string,
    update: TPurchaseStatusUpdate,
  ): Promise<void> {
    this.logger.log(
      `Purchase status update for ${refId}: ${update.status} - ${update.message}`,
    );

    await Promise.resolve();
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed:`, err);
  }

  @OnWorkerEvent("progress")
  onProgress(job: Job, progress: number | object) {
    this.logger.log(`Job ${job.id} progress: ${JSON.stringify(progress)}`);
  }
}
