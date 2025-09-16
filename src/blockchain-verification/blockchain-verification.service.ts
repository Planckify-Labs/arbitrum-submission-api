import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import {
  createPublicClient,
  http,
  PublicClient,
  Hash,
  Chain,
  Transaction,
  TransactionReceipt,
} from "viem";
import { PrismaService } from "../prisma/prisma.service";

export interface TTransactionVerificationResult {
  isValid: boolean;
  transactionHash: string;
  blockNumber: string;
  confirmations: number;
  from: string;
  to: string;
  value: string;
  status: "success" | "reverted";
  gasUsed: string;
  blockTimestamp: string;
  chainId: number;
}

export interface TTransactionVerificationRequest {
  transactionHash: string;
  expectedSender: string;
  expectedRecipient: string;
  expectedChainId: number;
  minimumConfirmations?: number;
}

@Injectable()
export class BlockchainVerificationService {
  private readonly logger = new Logger(BlockchainVerificationService.name);
  private readonly clients: Map<number, PublicClient> = new Map();
  private readonly DEFAULT_MIN_CONFIRMATIONS = 12;

  constructor(private readonly prisma: PrismaService) {
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
          const nativeToken = blockchain.tokens.find(
            (token) => token.isNativeCurrency,
          );

          const dynamicChain: Chain = {
            id: blockchain.chainId,
            name: blockchain.name,
            nativeCurrency: {
              name: nativeToken?.name || "Native Token",
              symbol: nativeToken?.symbol || "NATIVE",
              decimals: nativeToken?.decimals || 18,
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
          this.logger.log(
            `Initialized dynamic client for chain ${blockchain.chainId} (${blockchain.name}) with native currency ${nativeToken?.symbol || "NATIVE"}`,
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

  async verifyTransaction(
    request: TTransactionVerificationRequest,
  ): Promise<TTransactionVerificationResult> {
    const {
      transactionHash,
      expectedSender,
      expectedRecipient,
      expectedChainId,
      minimumConfirmations = this.DEFAULT_MIN_CONFIRMATIONS,
    } = request;

    this.logger.log(
      `Verifying transaction ${transactionHash} on chain ${expectedChainId}`,
    );

    try {
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

      const currentBlock = await client.getBlock({
        blockTag: "latest",
      });

      const result: TTransactionVerificationResult = {
        isValid: true,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        confirmations,
        from: transaction.from,
        to: transaction.to || "",
        value: transaction.value.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        blockTimestamp: currentBlock.timestamp.toString(),
        chainId: transaction.chainId || expectedChainId,
      };

      this.logger.log(
        `Transaction ${transactionHash} verified successfully with ${confirmations} confirmations`,
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
    minimumConfirmations: number = this.DEFAULT_MIN_CONFIRMATIONS,
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

  async validateTransactionAmount(
    transactionHash: string,
    chainId: number,
    expectedAmount: string,
    tokenAddress?: string,
    expectedRecipient?: string,
  ): Promise<boolean> {
    try {
      const client = this.getClient(chainId);

      const receipt: TransactionReceipt = await client.getTransactionReceipt({
        hash: transactionHash as Hash,
      });

      if (!receipt || receipt.status !== "success") {
        this.logger.warn(`Transaction ${transactionHash} failed or not found`);
        return false;
      }

      const isNativeToken =
        !tokenAddress ||
        tokenAddress === "0x0000000000000000000000000000000000000000";

      if (isNativeToken) {
        const transaction: Transaction = await client.getTransaction({
          hash: transactionHash as Hash,
        });

        const isAmountValid = transaction.value.toString() === expectedAmount;
        this.logger.log(
          `Native token validation - Expected: ${expectedAmount}, Actual: ${transaction.value.toString()}, Valid: ${isAmountValid}`,
        );
        return isAmountValid;
      } else {
        const transferEventSignature =
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

        const transferLogs = receipt.logs.filter(
          (log) =>
            log.topics[0] === transferEventSignature &&
            log.address.toLowerCase() === tokenAddress.toLowerCase(),
        );

        if (transferLogs.length === 0) {
          this.logger.warn(
            `No Transfer events found for token ${tokenAddress} in transaction ${transactionHash}`,
          );
          return false;
        }

        let relevantTransferLog = transferLogs[0];

        if (expectedRecipient) {
          const recipientTransfer = transferLogs.find((log) => {
            const toAddress = `0x${log.topics[2]?.slice(26)}`; // Remove padding
            return toAddress.toLowerCase() === expectedRecipient.toLowerCase();
          });

          if (recipientTransfer) {
            relevantTransferLog = recipientTransfer;
          } else {
            this.logger.warn(
              `No transfer to expected recipient ${expectedRecipient} found`,
            );
            return false;
          }
        }

        const amount = BigInt(relevantTransferLog.data || "0x0");

        const isAmountValid = amount.toString() === expectedAmount;
        this.logger.log(
          `ERC-20 token validation - Token: ${tokenAddress}, Expected: ${expectedAmount}, Actual: ${amount.toString()}, Valid: ${isAmountValid}`,
        );

        return isAmountValid;
      }
    } catch (error) {
      this.logger.error(
        `Error validating transaction amount: ${error.message}`,
      );
      return false;
    }
  }
}
