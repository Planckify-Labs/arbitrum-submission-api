import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import {
  createPublicClient,
  createWalletClient,
  http,
  PublicClient,
  WalletClient,
  Hash,
  Chain,
  Transaction,
  TransactionReceipt,
} from "viem";
import { readContract } from "viem/actions";
import { privateKeyToAccount } from "viem/accounts";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { addressesEqual } from "../auth/address-compare";
import { TakumiWalletAbi } from "./abis/takumi-wallet.abi";
import { TakumiWalletMerchantAbi } from "./abis/takumi-wallet-merchant.abi";
import {
  TTakumiWalletTransaction,
  TTransactionVerificationResult,
  TTransactionVerificationRequest,
} from "./types/blockchain-verification.types";
import { VerifyContractTransactionDto } from "./dto/verify-contract-transaction.dto";
import { getBlockchainConfig } from "../config/app.config";

@Injectable()
export class BlockchainVerificationService {
  private readonly logger = new Logger(BlockchainVerificationService.name);
  private readonly clients: Map<number, PublicClient> = new Map();
  private readonly walletClients: Map<number, WalletClient> = new Map();
  private readonly minConfirmations: number;
  private readonly adminAccount;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const blockchainConfig = getBlockchainConfig(this.configService);
    this.minConfirmations = blockchainConfig.minConfirmations;
    this.adminAccount = privateKeyToAccount(
      blockchainConfig.adminWalletPrivateKey as `0x${string}`,
    );
    this.initializeClients();
  }

  private async initializeClients() {
    try {
      const blockchains = await this.prisma.blockchain.findMany({
        where: { isActive: true },
        include: {
          tokens: {
            where: {
              isNativeCurrency: true,
              isActive: true,
            },
          },
        },
      });

      for (const blockchain of blockchains) {
        try {
          if (!blockchain.isEVM || blockchain.chainId == null) {
            this.logger.log(
              `Skipping non-EVM blockchain ${blockchain.name} — viem client not applicable`,
            );
            continue;
          }

          const nativeToken = blockchain.tokens.find(
            (token) => token.isNativeCurrency,
          );

          // Chain-extension discipline: native decimals MUST come from the
          // seeded `tokens` row where `isNativeCurrency = true`. Arc's native
          // is USDC with decimals=6 — a hardcoded `18` fallback would silently
          // mis-format Arc balances on any viem helper that inspects
          // `chain.nativeCurrency.decimals`. If seed is incomplete, skip this
          // chain rather than register with fake decimals.
          // Spec ref: umkm-usdc-payout-spec.md §7.1 (ChainConfig audit).
          if (!nativeToken) {
            this.logger.warn(
              `Skipping chain ${blockchain.name} (chainId=${blockchain.chainId}): no active native-currency token row found; native decimals unknown.`,
            );
            continue;
          }

          const dynamicChain: Chain = {
            id: blockchain.chainId,
            name: blockchain.name,
            nativeCurrency: {
              name: nativeToken.name,
              symbol: nativeToken.symbol,
              decimals: nativeToken.decimals,
            },
            rpcUrls: {
              default: {
                http: [blockchain.rpcUrl],
              },
              public: {
                http: [blockchain.rpcUrl],
              },
            },
            blockExplorers: blockchain.blockExplorer
              ? {
                  default: {
                    name: `${blockchain.name} Explorer`,
                    url: blockchain.blockExplorer,
                  },
                }
              : undefined,
            testnet: blockchain.isTestnet,
          };

          const client = createPublicClient({
            chain: dynamicChain,
            transport: http(blockchain.rpcUrl),
          }) as PublicClient;

          this.clients.set(blockchain.chainId, client);

          const walletClient = createWalletClient({
            account: this.adminAccount,
            chain: dynamicChain,
            transport: http(blockchain.rpcUrl),
          });
          this.walletClients.set(blockchain.chainId, walletClient);

          this.logger.log(
            `Initialized dynamic client for chain ${blockchain.chainId} (${blockchain.name}) with native currency ${nativeToken.symbol} (decimals=${nativeToken.decimals})`,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to initialize client for chain ${blockchain.chainId}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to initialize blockchain clients from database: ${error.message}`,
      );
    }
  }

  private getClient(chainId: number): PublicClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new BadRequestException(`Unsupported chain ID: ${chainId}`);
    }
    return client;
  }

  getPublicClient(chainId: number): PublicClient {
    return this.getClient(chainId);
  }

  private getWalletClient(chainId: number): WalletClient {
    const client = this.walletClients.get(chainId);
    if (!client) {
      throw new BadRequestException(
        `Unsupported chain ID for wallet client: ${chainId}`,
      );
    }
    return client;
  }

  /**
   * Phase A — tx-receipt-level verification only.
   *
   * Waits for the transaction receipt with the required confirmations,
   * then validates: receipt status, chain ID, sender, recipient, and
   * confirmation count. Does NOT verify contract-level data (Phase B).
   *
   * Extracted from `verifyTransaction` (task 16) so that callers needing
   * only receipt-level checks (e.g. the onchain settlement provider) can
   * call this independently, while `verifyTransaction` continues to use
   * it internally before proceeding to Phase B.
   */
  async verifyTxReceiptOnly(args: {
    transactionHash: string;
    expectedSender: string;
    expectedRecipient: string;
    expectedChainId: number;
    minimumConfirmations?: number;
  }): Promise<{ receipt: TransactionReceipt; transaction: Transaction; confirmations: number }> {
    const {
      transactionHash,
      expectedSender,
      expectedRecipient,
      expectedChainId,
      minimumConfirmations = this.minConfirmations,
    } = args;

    const client = this.getClient(expectedChainId);

    const receipt: TransactionReceipt =
      await client.waitForTransactionReceipt({
        hash: transactionHash as Hash,
        confirmations: minimumConfirmations,
        timeout: 60_000,
      });

    const transaction: Transaction = await client.getTransaction({
      hash: transactionHash as Hash,
    });

    const confirmations = await this.getTransactionConfirmations(
      transactionHash,
      expectedChainId,
    );

    if (receipt.status !== "success") {
      throw new BadRequestException(
        `Transaction ${transactionHash} was reverted or failed`,
      );
    }

    if (transaction.chainId !== expectedChainId) {
      throw new BadRequestException(
        `Chain ID mismatch: expected ${expectedChainId}, got ${transaction.chainId}`,
      );
    }

    if (transaction.from.toLowerCase() !== expectedSender.toLowerCase()) {
      throw new BadRequestException(
        `Sender address mismatch: expected ${expectedSender}, got ${transaction.from}`,
      );
    }

    if (transaction.to?.toLowerCase() !== expectedRecipient.toLowerCase()) {
      throw new BadRequestException(
        `Recipient address mismatch: expected ${expectedRecipient}, got ${transaction.to}`,
      );
    }

    if (confirmations < minimumConfirmations) {
      throw new BadRequestException(
        `Insufficient confirmations: ${confirmations}/${minimumConfirmations}`,
      );
    }

    return { receipt, transaction, confirmations };
  }

  async verifyTransaction(
    request: TTransactionVerificationRequest,
  ): Promise<TTransactionVerificationResult> {
    const {
      transactionHash,
      expectedSender,
      expectedRecipient,
      expectedChainId,
      minimumConfirmations = this.minConfirmations,
    } = request;

    this.logger.log(
      `Verifying transaction ${transactionHash} on chain ${expectedChainId}`,
    );

    try {
      // Phase A — tx-receipt checks (delegated to verifyTxReceiptOnly)
      const { receipt, transaction, confirmations } =
        await this.verifyTxReceiptOnly({
          transactionHash,
          expectedSender,
          expectedRecipient,
          expectedChainId,
          minimumConfirmations,
        });

      const client = this.getClient(expectedChainId);
      const currentBlock = await client.getBlock({
        blockTag: "latest",
      });

      const result: TTransactionVerificationResult = {
        isValid: true,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        confirmations,
        from: transaction.from,
        to: transaction.to ?? "",
        value: transaction.value.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        blockTimestamp: currentBlock.timestamp.toString(),
        chainId: transaction.chainId || expectedChainId,
      };

      this.logger.log(
        `Transaction ${transactionHash} verified successfully with ${confirmations} confirmations`,
      );

      // Phase B — contract-level verification
      await this.verifyTransactionInContract({
        refId: request.refId,
        contractAddress: request.contractAddress,
        chainId: expectedChainId,
        expectedWalletAddress: transaction.from,
        expectedTokenAddress: transaction.to ?? "",
        expectedAmount: request.expectedAmount,
        expectedBookingId: request.expectedBookingId,
        expectedExchangeRateId: request.expectedExchangeRateId,
        expectedProductVariantId: request.expectedProductVariantId,
      });
      this.logger.log(
        `Contract verification successful for refId ${request.refId}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Transaction verification failed: ${error.message}`,
        error.stack,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Failed to verify transaction ${transactionHash}: ${error.message}`,
      );
    }
  }

  async isTransactionConfirmed(
    transactionHash: string,
    chainId: number,
    minimumConfirmations: number = this.minConfirmations,
  ): Promise<boolean> {
    try {
      const client = this.getClient(chainId);

      const receipt = await client.getTransactionReceipt({
        hash: transactionHash as Hash,
      });

      if (!receipt) {
        return false;
      }

      const currentBlockNumber = await client.getBlockNumber();
      const confirmations =
        Number(currentBlockNumber) - Number(receipt.blockNumber);

      return (
        confirmations >= minimumConfirmations && receipt.status === "success"
      );
    } catch (error) {
      this.logger.error(
        `Error checking transaction confirmation: ${error.message}`,
      );
      return false;
    }
  }

  async getTransactionConfirmations(
    transactionHash: string,
    chainId: number,
  ): Promise<number> {
    try {
      const client = this.getClient(chainId);

      const receipt = await client.getTransactionReceipt({
        hash: transactionHash as Hash,
      });

      if (!receipt) {
        return 0;
      }

      const currentBlockNumber = await client.getBlockNumber();
      return Number(currentBlockNumber - receipt.blockNumber) + 1;
    } catch (error) {
      this.logger.error(
        `Error getting transaction confirmations: ${error.message}`,
      );
      return 0;
    }
  }

  async verifyTransactionInContract(
    trxData: VerifyContractTransactionDto,
  ): Promise<TTakumiWalletTransaction> {
    try {
      this.logger.log(
        `Verifying transaction in contract ${trxData.contractAddress} for refId ${trxData.refId} on chain ${trxData.chainId}`,
      );

      const walletClient = this.getWalletClient(trxData.chainId);
      const contractTransaction = await readContract(walletClient, {
        address: trxData.contractAddress as `0x${string}`,
        abi: TakumiWalletAbi,
        functionName: "getTransactionByRef",
        args: [trxData.refId],
      });

      const transaction: TTakumiWalletTransaction = {
        walletAddress: contractTransaction.walletAddress,
        tokenAddress: contractTransaction.tokenAddress,
        bookingId: contractTransaction.bookingId,
        exchangeRateId: contractTransaction.exchangeRateId,
        productVariantId: contractTransaction.productVariantId,
        timestamp: contractTransaction.timestamp,
        refId: contractTransaction.refId,
        amount: contractTransaction.amount,
      };

      if (transaction.refId !== trxData.refId) {
        throw new BadRequestException(
          `Contract refId mismatch: expected ${trxData.refId}, got ${transaction.refId}`,
        );
      }

      // EVM-only: both addresses come from viem (0x hex).
      if (
        !addressesEqual(
          transaction.walletAddress,
          trxData.expectedWalletAddress,
        )
      ) {
        throw new BadRequestException(
          `Contract wallet address mismatch: expected ${trxData.expectedWalletAddress}, got ${transaction.walletAddress}`,
        );
      }

      const isNativeToken =
        trxData.expectedTokenAddress ===
          "0x0000000000000000000000000000000000000000" ||
        trxData.expectedTokenAddress.toLowerCase() ===
          trxData.contractAddress.toLowerCase();

      if (
        !isNativeToken &&
        transaction.tokenAddress.toLowerCase() !==
          trxData.expectedTokenAddress.toLowerCase()
      ) {
        throw new BadRequestException(
          `Contract token address mismatch: expected ${trxData.expectedTokenAddress}, got ${transaction.tokenAddress}`,
        );
      }

      if (transaction.amount.toString() !== trxData.expectedAmount) {
        throw new BadRequestException(
          `Contract amount mismatch: expected ${trxData.expectedAmount}, got ${transaction.amount.toString()}`,
        );
      }

      if (
        trxData.expectedBookingId &&
        transaction.bookingId !== trxData.expectedBookingId
      ) {
        throw new BadRequestException(
          `Contract bookingId mismatch: expected ${trxData.expectedBookingId}, got ${transaction.bookingId}`,
        );
      }

      if (
        trxData.expectedExchangeRateId &&
        Number(transaction.exchangeRateId) !==
          Number(trxData.expectedExchangeRateId)
      ) {
        throw new BadRequestException(
          `Contract exchangeRateId mismatch: expected ${trxData.expectedExchangeRateId}, got ${transaction.exchangeRateId}`,
        );
      }

      if (
        trxData.expectedProductVariantId &&
        transaction.productVariantId !== trxData.expectedProductVariantId
      ) {
        throw new BadRequestException(
          `Contract productVariantId mismatch: expected ${trxData.expectedProductVariantId}, got ${transaction.productVariantId}`,
        );
      }

      this.logger.log(
        `Contract verification successful: refId=${transaction.refId}, wallet=${transaction.walletAddress}, amount=${transaction.amount.toString()}, bookingId=${transaction.bookingId}, exchangeRateId=${transaction.exchangeRateId}, productVariantId=${transaction.productVariantId}`,
      );

      return transaction;
    } catch (error) {
      this.logger.error(
        `Contract verification failed for refId ${trxData.refId}: ${error.message}`,
        error.stack,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Failed to verify transaction in contract: ${error.message}`,
      );
    }
  }

  /**
   * Verify a merchant payment in the TakumiWalletMerchant contract (task 17).
   *
   * Calls `readContract` with `getMerchantPaymentByRef(refId)` on the
   * merchant contract ABI and compares all returned fields against the
   * expected values from the DB. Throws `BadRequestException` with a
   * specific message on any mismatch.
   *
   * The MerchantPayment struct returned by the contract:
   *   payer, tokenAddress, merchantId, refId, amount, platformFeeAmount,
   *   fiatAmountMinor, fiatCurrency, exchangeRateId, timestamp.
   */
  async verifyMerchantPaymentInContract(args: {
    contractAddress: string;
    chainId: number;
    refId: string;
    expectedPayer: string;
    expectedMerchantId: string;
    expectedTokenAddress: string;
    expectedAmount: string;
    expectedFiatAmountMinor: number;
    expectedFiatCurrency: string;
    expectedExchangeRateId: number;
  }): Promise<void> {
    try {
      this.logger.log(
        `Verifying merchant payment in contract ${args.contractAddress} for refId ${args.refId} on chain ${args.chainId}`,
      );

      const walletClient = this.getWalletClient(args.chainId);
      const payment = await readContract(walletClient, {
        address: args.contractAddress as `0x${string}`,
        abi: TakumiWalletMerchantAbi,
        functionName: "getMerchantPaymentByRef",
        args: [args.refId],
      });

      if (payment.refId !== args.refId) {
        throw new BadRequestException(
          `Merchant payment refId mismatch: expected ${args.refId}, got ${payment.refId}`,
        );
      }

      if (!addressesEqual(payment.payer, args.expectedPayer)) {
        throw new BadRequestException(
          `Merchant payment payer mismatch: expected ${args.expectedPayer}, got ${payment.payer}`,
        );
      }

      if (payment.merchantId !== args.expectedMerchantId) {
        throw new BadRequestException(
          `Merchant payment merchantId mismatch: expected ${args.expectedMerchantId}, got ${payment.merchantId}`,
        );
      }

      // Handle native token sentinel: address(0) represents native currency
      const isNativeToken =
        args.expectedTokenAddress === "0x0000000000000000000000000000000000000000" ||
        args.expectedTokenAddress.toLowerCase() === args.contractAddress.toLowerCase();

      if (
        !isNativeToken &&
        payment.tokenAddress.toLowerCase() !== args.expectedTokenAddress.toLowerCase()
      ) {
        throw new BadRequestException(
          `Merchant payment tokenAddress mismatch: expected ${args.expectedTokenAddress}, got ${payment.tokenAddress}`,
        );
      }

      if (payment.amount.toString() !== args.expectedAmount) {
        throw new BadRequestException(
          `Merchant payment amount mismatch: expected ${args.expectedAmount}, got ${payment.amount.toString()}`,
        );
      }

      if (Number(payment.fiatAmountMinor) !== args.expectedFiatAmountMinor) {
        throw new BadRequestException(
          `Merchant payment fiatAmountMinor mismatch: expected ${args.expectedFiatAmountMinor}, got ${payment.fiatAmountMinor}`,
        );
      }

      if (Number(payment.exchangeRateId) !== args.expectedExchangeRateId) {
        throw new BadRequestException(
          `Merchant payment exchangeRateId mismatch: expected ${args.expectedExchangeRateId}, got ${payment.exchangeRateId}`,
        );
      }

      this.logger.log(
        `Merchant payment contract verification successful: refId=${payment.refId}, payer=${payment.payer}, amount=${payment.amount.toString()}, merchantId=${payment.merchantId}`,
      );
    } catch (error) {
      this.logger.error(
        `Merchant payment contract verification failed for refId ${args.refId}: ${error.message}`,
        error.stack,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Failed to verify merchant payment in contract: ${error.message}`,
      );
    }
  }

  /**
   * Verify a point deposit transaction on-chain.
   * 1. Waits for the tx receipt with the required confirmations.
   * 2. Reads the PointDeposit contract's getTransactionByRef(refId).
   * 3. Validates the returned deposit data against expected values.
   */
  async verifyPointDeposit(params: {
    txHash: string;
    chainId: number;
    contractAddress: string;
    refId: string;
    expectedWalletAddress: string;
    expectedTokenAddress: string;
    expectedAmount: bigint;
    minConfirmations?: number;
  }): Promise<{ walletAddress: string; tokenAddress: string; amount: bigint }> {
    const {
      txHash,
      chainId,
      contractAddress,
      refId,
      expectedWalletAddress,
      expectedTokenAddress,
      expectedAmount,
      minConfirmations = 12,
    } = params;

    this.logger.log(
      `Verifying point deposit tx ${txHash} on chain ${chainId} for refId ${refId}`,
    );

    try {
      const client = this.getClient(chainId);

      const receipt = await client.waitForTransactionReceipt({
        hash: txHash as Hash,
        confirmations: minConfirmations,
        timeout: 60_000,
      });

      if (receipt.status !== "success") {
        throw new BadRequestException(
          `Point deposit transaction ${txHash} was reverted or failed`,
        );
      }

      const walletClient = this.getWalletClient(chainId);
      const contractTx = await readContract(walletClient, {
        address: contractAddress as `0x${string}`,
        abi: TakumiWalletAbi,
        functionName: "getPointDepositByRef",
        args: [refId],
      });

      // EVM-only: viem contract read returns 0x hex addresses.
      if (!addressesEqual(contractTx.walletAddress, expectedWalletAddress)) {
        throw new BadRequestException(
          `Point deposit wallet mismatch: expected ${expectedWalletAddress}, got ${contractTx.walletAddress}`,
        );
      }

      if (contractTx.tokenAddress.toLowerCase() !== expectedTokenAddress.toLowerCase()) {
        throw new BadRequestException(
          `Point deposit token mismatch: expected ${expectedTokenAddress}, got ${contractTx.tokenAddress}`,
        );
      }

      if (contractTx.amount !== expectedAmount) {
        throw new BadRequestException(
          `Point deposit amount mismatch: expected ${expectedAmount}, got ${contractTx.amount}`,
        );
      }

      this.logger.log(
        `Point deposit verified: refId=${refId}, wallet=${contractTx.walletAddress}, amount=${contractTx.amount}`,
      );

      return {
        walletAddress: contractTx.walletAddress,
        tokenAddress: contractTx.tokenAddress,
        amount: contractTx.amount,
      };
    } catch (error) {
      this.logger.error(
        `Point deposit verification failed for refId ${refId}: ${error.message}`,
        error.stack,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Failed to verify point deposit: ${error.message}`,
      );
    }
  }
}
