import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { BlockchainVerificationService } from "../../blockchain-verification/blockchain-verification.service";
import { VCGamersService } from "../../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import { ReferenceIdService } from "../../reference-id/reference-id.service";
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
    } = job.data;

    this.logger.log(`Processing purchase job ${job.id} for refId: ${refId}`);

    try {
      await this.updatePurchaseStatus(refId, {
        refId,
        status: "blockchain_verifying",
        stage: "blockchain_verification",
        message: "Starting blockchain transaction verification",
      });

      const booking = await this.validateAndPrepareBooking(
        bookingId,
        walletAddress,
        networkId,
        contractAddress,
      );

      const user = await this.createOrGetUser(walletAddress);

      const token = await this.validateToken(
        networkId,
        booking.payment.tokenAddress,
      );

      await this.updatePurchaseStatus(refId, {
        refId,
        status: "blockchain_verifying",
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
        booking.blockchain.chainId,
        refId,
        contractAddress,
        booking.id,
        (
          booking.exchangeRate as { id?: number | string } | null
        )?.id?.toString() || "0",
        booking.productVariantId,
        booking.payment.amount,
      );

      const transaction = await this.createTransactionRecord(
        user.id,
        token.id,
        booking.payment.amount,
        booking.exchangeRate as { rate: number } | null,
        booking.productPrice?.sellPrice?.toString() || "0",
        walletAddress,
        contractAddress,
        transactionHash,
      );

      const purchase = await this.createPurchaseRecord(
        transaction.id,
        booking.productVariantId,
        refId,
      );

      await this.updatePurchaseStatus(refId, {
        refId,
        purchaseId: purchase.id,
        status: "blockchain_verified",
        stage: "blockchain_verified",
        message: "Blockchain transaction verified successfully",
      });

      if (booking.productPrice?.vendor?.name === "vcGamer") {
        await this.processVendorOrder(
          purchase.id,
          booking as unknown as TBookingWithRelations,
          refId,
        );
      }

      await this.prisma.bookingOrder.update({
        where: { id: bookingId },
        data: { status: BookingStatus.EXECUTED },
      });

      await this.updatePurchaseStatus(refId, {
        refId,
        purchaseId: purchase.id,
        status: "completed",
        stage: "completed",
        message: "Purchase completed successfully",
      });

      await this.referenceIdService.markAsCompleted(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        purchaseId: purchase.id,
        vendorName: booking.productPrice?.vendor?.name,
        vendorId: booking.productPrice?.vendorId,
        productCode: booking.productVariant.product.code,
        productName: booking.productVariant.product.name,
        variantSku: booking.productVariant.sku,
        status: "completed_successfully",
      });

      this.logger.log(
        `Purchase job ${job.id} completed successfully for refId: ${refId}`,
      );

      return {
        success: true,
        purchaseId: purchase.id,
        transactionId: transaction.id,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Purchase job ${job.id} failed for refId: ${refId}:`,
        error,
      );

      await this.updatePurchaseStatus(refId, {
        refId,
        status: "failed",
        stage: "error",
        message: "Purchase processing failed",
        error: errorMessage,
      });

      await this.referenceIdService.markAsFailed(refId, {
        requestType: "PURCHASE",
        walletAddress,
        bookingId,
        error: errorMessage,
        errorType: "purchase_processing_error",
      });

      throw error;
    }
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

    if (booking.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
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

    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: networkId },
    });

    if (!blockchain || !blockchain.isActive) {
      throw new Error(`Network ${blockchain?.name || networkId} is not active`);
    }

    const smartContract = await this.prisma.smartContract.findFirst({
      where: {
        blockchainId: networkId,
        address: { equals: contractAddress, mode: "insensitive" },
      },
    });

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

  private async createOrGetUser(walletAddress: string) {
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

    return user;
  }

  private async validateToken(networkId: string, tokenAddress: string) {
    const token = await this.prisma.token.findUnique({
      where: {
        blockchainId_contractAddress: {
          blockchainId: networkId,
          contractAddress: tokenAddress,
        },
      },
    });

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

  private async createTransactionRecord(
    userId: string,
    tokenId: string,
    amount: string,
    exchangeRate: { rate: number } | null,
    sellPrice: string,
    senderAddress: string,
    recipientAddress: string,
    txHash: string,
  ) {
    const exchangeRateObj = exchangeRate as { rate: number } | null;
    const rate = exchangeRateObj?.rate || 0;
    const amountInFiat =
      rate && sellPrice ? (Number(sellPrice) * rate).toString() : "0";

    return await this.prisma.transactionHistory.create({
      data: {
        user: { connect: { id: userId } },
        token: { connect: { id: tokenId } },
        amount,
        amountInFiat,
        fiatCurrency: "IDR",
        type: TransactionType.PAYMENT,
        status: TransactionStatus.CONFIRMED,
        senderAddress,
        recipientAddress,
        txHash,
      },
    });
  }

  private async createPurchaseRecord(
    transactionId: string,
    productVariantId: string,
    refId: string,
  ) {
    return await this.prisma.purchase.create({
      data: {
        transaction: { connect: { id: transactionId } },
        productVariant: { connect: { id: productVariantId } },
        status: PurchaseStatus.PENDING,
        refId,
      },
    });
  }

  private async processVendorOrder(
    purchaseId: string,
    booking: TBookingWithRelations,
    refId: string,
  ) {
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
    const variationKey = booking.productVariant.sku;
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
      variantSku: booking.productVariant.sku,
      vendorAction: "creating_order",
    });

    const orderResponse = await this.vcGamersService.createOrder(
      brandKey,
      variationKey,
      price,
      formData,
      refId,
    );

    if (!orderResponse.success) {
      throw new Error(`Failed to process order: ${orderResponse.message}`);
    }

    const vendorRefId = orderResponse.data?.data.trx_code;
    const vendorResponse = orderResponse.data as unknown as Prisma.JsonValue;

    await this.prisma.purchase.update({
      where: { id: purchaseId },
      data: {
        vendorRefId,
        vendorResponse: vendorResponse as Prisma.InputJsonValue,
        status: PurchaseStatus.COMPLETED,
      },
    });
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
