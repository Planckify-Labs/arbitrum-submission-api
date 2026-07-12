import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { BlockchainVerificationService } from "../../blockchain-verification/blockchain-verification.service";
import { PointsCacheService } from "../../valkey/services/points-cache.service";
import { PointTransactionStatus, Prisma } from "@generated/prisma";

interface PointDepositJobData {
  pointTransactionId: string;
  pointTransactionCreatedAt: Date;
}

@Processor("point-deposit", { concurrency: 5 })
export class PointDepositProcessor extends WorkerHost {
  private readonly logger = new Logger(PointDepositProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainVerification: BlockchainVerificationService,
    private readonly pointsCache: PointsCacheService,
  ) {
    super();
  }

  async process(job: Job<PointDepositJobData>): Promise<void> {
    const { pointTransactionId, pointTransactionCreatedAt } = job.data;
    const txKey = { id: pointTransactionId, createdAt: new Date(pointTransactionCreatedAt) };

    this.logger.log(`Processing point deposit job ${job.id} for tx ${pointTransactionId}`);

    // 2. Fetch PointTransaction with relations
    const pointTx = await this.prisma.pointTransaction.findUnique({
      where: { id_createdAt: txKey },
      include: {
        user: { select: { id: true, walletAddress: true } },
        token: true,
        blockchain: true,
      },
    });

    if (!pointTx) {
      this.logger.warn(`PointTransaction ${pointTransactionId} not found — skipping`);
      return;
    }

    if (pointTx.status !== PointTransactionStatus.PENDING) {
      this.logger.warn(
        `PointTransaction ${pointTransactionId} is ${pointTx.status} — skipping`,
      );
      return;
    }

    try {
      // 3 & 4. Verify tx receipt + read contract
      const token = pointTx.token!;
      const blockchain = pointTx.blockchain!;
      const user = pointTx.user;

      if (!user.walletAddress) {
        throw new Error("User has no wallet address");
      }
      if (!token.contractAddress) {
        throw new Error(`Token ${token.symbol} has no contract address`);
      }
      // Only EVM chains need a real chainId — Solana/Stellar dispatch off
      // blockchainId instead (see BlockchainVerificationService.verifyPointDeposit).
      if (blockchain.type === "EVM" && blockchain.chainId == null) {
        throw new Error(`EVM blockchain ${blockchain.name} is missing chainId`);
      }

      await this.blockchainVerification.verifyPointDeposit({
        txHash: pointTx.txHash!,
        chainId: blockchain.chainId ?? 0,
        contractAddress: pointTx.contractAddress ?? "",
        refId: pointTx.refId!,
        // Prefer the deposit's own recorded payer (validated against the
        // user's linked addresses at submission time) so non-EVM chains
        // verify the real on-chain payer; fall back to the user's primary
        // address for legacy rows created before this column existed.
        expectedWalletAddress: pointTx.walletAddress ?? user.walletAddress,
        expectedTokenAddress: token.contractAddress,
        expectedAmount: BigInt(pointTx.tokenAmount!.toFixed(0)),
        minConfirmations: 12,
        blockchainId: blockchain.id,
      });

      // 5. Mark CONFIRMED
      await this.prisma.pointTransaction.update({
        where: { id_createdAt: txKey },
        data: { status: PointTransactionStatus.CONFIRMED },
      });

      // 6. Calculate final points
      // pointRate was stored at submission time (pointsPerToken)
      const pointRate = pointTx.pointRate ?? new Prisma.Decimal(0);
      const humanAmount = new Prisma.Decimal(pointTx.tokenAmount!.toString()).div(
        new Prisma.Decimal(10).pow(token.decimals),
      );
      // Round rather than floor: the deposited token amount is quantized to
      // the token's decimals, so it will essentially never multiply back to
      // an exact integer point count. Flooring always rounds that quantization
      // noise against the user; round-half-up is unbiased and matches what
      // the depositor actually requested.
      const points = BigInt(humanAmount.mul(pointRate).round().toFixed(0));

      // 7. Credit points atomically
      await this.prisma.$transaction(async (tx) => {
        const balance = await tx.pointBalance.findUnique({
          where: { userId: pointTx.userId },
        });

        const currentBalance = balance?.balance ?? BigInt(0);
        const newBalance = currentBalance + points;

        if (!balance) {
          await tx.pointBalance.create({
            data: { userId: pointTx.userId, balance: newBalance },
          });
        } else {
          await tx.pointBalance.update({
            where: { userId: pointTx.userId },
            data: { balance: newBalance },
          });
        }

        await tx.pointTransaction.update({
          where: { id_createdAt: txKey },
          data: {
            status: PointTransactionStatus.COMPLETED,
            amount: points,
            balanceBefore: currentBalance,
            balanceAfter: newBalance,
          },
        });
      });

      // 8. Invalidate cache
      await this.pointsCache.invalidateBalance(pointTx.userId);

      this.logger.log(
        `Point deposit ${pointTransactionId} completed: credited ${points} points to user ${pointTx.userId}`,
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.logger.error(
        `Point deposit ${pointTransactionId} failed: ${errorMessage}`,
      );

      await this.prisma.pointTransaction.update({
        where: { id_createdAt: txKey },
        data: {
          status: PointTransactionStatus.FAILED,
          metadata: { error: errorMessage, failedAt: new Date().toISOString() },
        },
      });

      throw error; // Allow BullMQ to retry
    }
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.log(`Point deposit job ${job.id} completed`);
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job, err: Error) {
    this.logger.error(`Point deposit job ${job.id} failed:`, err.message);
  }
}
