import { PointTransactionStatus, Prisma } from "@generated/prisma";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { BlockchainVerificationService } from "../../blockchain-verification/blockchain-verification.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";
import { truncateAddress } from "../../utils/address";
import { PointsCacheService } from "../../valkey/services/points-cache.service";

interface PointDepositJobData {
  pointTransactionId: string;
  pointTransactionCreatedAt: Date;
}

// Matches the "en-US" grouping used for points/currency everywhere else
// in the app (see mobile `utils/currencyUtils.ts` formatNumber) — accepts
// bigint directly, no need to round-trip through Number.
const POINTS_NUMBER_FORMAT = new Intl.NumberFormat("en-US");

@Processor("point-deposit", { concurrency: 5 })
export class PointDepositProcessor extends WorkerHost {
  private readonly logger = new Logger(PointDepositProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainVerification: BlockchainVerificationService,
    private readonly pointsCache: PointsCacheService,
    private readonly pushService: PushService,
  ) {
    super();
  }

  async process(job: Job<PointDepositJobData>): Promise<void> {
    const { pointTransactionId, pointTransactionCreatedAt } = job.data;
    const txKey = {
      id: pointTransactionId,
      createdAt: new Date(pointTransactionCreatedAt),
    };

    this.logger.log(
      `Processing point deposit job ${job.id} for tx ${pointTransactionId}`,
    );

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
      this.logger.warn(
        `PointTransaction ${pointTransactionId} not found — skipping`,
      );
      return;
    }

    if (pointTx.status !== PointTransactionStatus.PENDING) {
      this.logger.warn(
        `PointTransaction (tx ${pointTx.txHash}) is ${pointTx.status} — skipping`,
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
      const humanAmount = new Prisma.Decimal(
        pointTx.tokenAmount!.toString(),
      ).div(new Prisma.Decimal(10).pow(token.decimals));
      // Round rather than floor: the deposited token amount is quantized to
      // the token's decimals, so it will essentially never multiply back to
      // an exact integer point count. Flooring always rounds that quantization
      // noise against the user; round-half-up is unbiased and matches what
      // the depositor actually requested.
      const points = BigInt(humanAmount.mul(pointRate).round().toFixed(0));

      // 7. Credit points atomically
      const finalBalance = await this.prisma.$transaction(async (tx) => {
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

        return newBalance;
      });

      // 8. Invalidate cache
      await this.pointsCache.invalidateBalance(pointTx.userId);

      this.logger.log(
        `Point deposit (tx ${pointTx.txHash}) completed: credited ${points} points to wallet ${truncateAddress(user.walletAddress)}`,
      );

      // Best-effort — a push failure must never fail (and re-trigger a
      // retry of) an already-completed deposit.
      const pointsFormatted = POINTS_NUMBER_FORMAT.format(points);
      const balanceFormatted = POINTS_NUMBER_FORMAT.format(finalBalance);
      await this.pushService
        .sendToUser({
          userId: pointTx.userId,
          title: `Congrats! +${pointsFormatted} points recieved 🎉`,
          body: `${pointsFormatted} points added, your total point is now ${balanceFormatted} points.`,
          data: {
            type: "point_deposit",
            pointTransactionId,
            status: "COMPLETED",
          },
          channelId: "points",
          source: "point_deposit",
        })
        .catch((err) => {
          this.logger.warn(
            `[point-deposit] push failed for tx ${pointTx.txHash}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      this.logger.error(
        `Point deposit (tx ${pointTx.txHash}) failed (attempt ${job.attemptsMade}): ${errorMessage}`,
      );

      // Deliberately leave `status` as PENDING here. Flipping it to FAILED
      // on every attempt was the bug: the next BullMQ retry re-fetches
      // pointTx, sees status !== PENDING, and hits the guard above —
      // returning (resolving) instead of throwing. That silently ate every
      // configured retry (attempts: 5) after the first failure. Recording
      // the error in metadata (without touching status) preserves
      // debuggability while letting the retry actually re-run verification.
      await this.prisma.pointTransaction
        .update({
          where: { id_createdAt: txKey },
          data: {
            metadata: {
              lastError: errorMessage,
              lastAttemptAt: new Date().toISOString(),
              attemptsMade: job.attemptsMade,
            },
          },
        })
        .catch((metaErr) => {
          this.logger.warn(
            `[point-deposit] failed to record attempt metadata for tx ${pointTx.txHash}: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`,
          );
        });

      throw error; // Let BullMQ retry with backoff
    }
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.log(`Point deposit job ${job.id} completed`);
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<PointDepositJobData>, err: Error) {
    const maxAttempts = job.opts?.attempts ?? 1;
    this.logger.error(
      `Point deposit job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${err.message}`,
    );

    // Only the truly final attempt marks the deposit terminally FAILED
    // and notifies the user — earlier attempts still have retries pending.
    if (job.attemptsMade < maxAttempts) return;

    const { pointTransactionId, pointTransactionCreatedAt } = job.data;
    await this.markTerminallyFailed(
      pointTransactionId,
      new Date(pointTransactionCreatedAt),
      err.message,
    );
  }

  private async markTerminallyFailed(
    pointTransactionId: string,
    createdAt: Date,
    errorMessage: string,
  ): Promise<void> {
    const txKey = { id: pointTransactionId, createdAt };

    const pointTx = await this.prisma.pointTransaction.findUnique({
      where: { id_createdAt: txKey },
      select: { userId: true, status: true },
    });

    // Guard against a race with a concurrent successful completion, and
    // against double-marking if this ever runs twice.
    if (!pointTx || pointTx.status !== PointTransactionStatus.PENDING) return;

    await this.prisma.pointTransaction.update({
      where: { id_createdAt: txKey },
      data: {
        status: PointTransactionStatus.FAILED,
        metadata: { error: errorMessage, failedAt: new Date().toISOString() },
      },
    });

    // Best-effort. Never surface `errorMessage` to the user — it's an
    // internal verification detail, not user-facing copy.
    await this.pushService
      .sendToUser({
        userId: pointTx.userId,
        title: "Deposit Failed",
        body: "We couldn't confirm your deposit after several attempts. If you've already sent the payment, please contact support and we'll help sort it out.",
        data: {
          type: "point_deposit",
          pointTransactionId,
          status: "FAILED",
        },
        channelId: "points",
        source: "point_deposit",
      })
      .catch((pushErr) => {
        this.logger.warn(
          `[point-deposit] failure push failed for ${pointTransactionId}: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
        );
      });
  }
}
