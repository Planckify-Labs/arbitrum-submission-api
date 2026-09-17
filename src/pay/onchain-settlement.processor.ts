import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { type Job, UnrecoverableError } from "bullmq";
import {
  SETTLEMENT_MAX_ATTEMPTS,
  TRANSIENT,
  classifySettlementError,
  settlementBackoffStrategy,
} from "../blockchain-verification/settlement-policy";
import { PrismaService } from "../prisma/prisma.service";
import {
  IntentsService,
  ONCHAIN_SETTLEMENT_QUEUE,
  type OnchainSettlementJobData,
} from "./intents.service";

/**
 * Verifies an on-chain merchant payment against the chain, off the
 * request path. One job per (intentId, txHash), enqueued by
 * `IntentsService.submitOnchain` the moment the client hands over the
 * hash.
 *
 * Outcome rules (see `settlement-policy.ts` for the classifier):
 *
 *   verified            → SETTLED, payout, activity COMPLETED, push
 *                         "Payment sent".
 *   rejected_reverted   → the chain refused the tx, nothing moved.
 *                         Intent FAILED, activity FAILED, push "didn't go
 *                         through, you weren't charged". No retry.
 *   rejected_mismatch   → mined, but not the quoted payment. Intent stays
 *                         SIGNED, row NEEDS_REVIEW for ops, push "we're
 *                         checking". No retry.
 *   transient           → no chain verdict (receipt not yet available,
 *                         RPC down, chain client missing, DB hiccup).
 *                         Recorded, retried on the long schedule, and the
 *                         user is told NOTHING — they already paid.
 *   transient, budget   → after ~a day still no verdict: NEEDS_REVIEW +
 *   spent                 push "we're checking". Still never "failed".
 *
 * The queue is registered with `backoff: { type: "custom" }` and this
 * worker's `settings.backoffStrategy`, so the schedule lives in one place.
 */
@Processor(ONCHAIN_SETTLEMENT_QUEUE, {
  concurrency: 5,
  settings: { backoffStrategy: settlementBackoffStrategy },
})
export class OnchainSettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(OnchainSettlementProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intents: IntentsService,
  ) {
    super();
  }

  async process(job: Job<OnchainSettlementJobData>): Promise<void> {
    const { intentId, txHash, blockchainId } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.log(
      `[onchain-settlement] intent=${intentId} txHash=${txHash} attempt=${attempt}/${job.opts.attempts ?? 1}`,
    );

    const [intent, blockchain, row] = await Promise.all([
      this.prisma.paymentIntent.findUnique({
        where: { id: intentId },
        include: { merchant: true, payer: true },
      }),
      this.prisma.blockchain.findUnique({ where: { id: blockchainId } }),
      this.prisma.onchainSettlement.findFirst({ where: { intentId, txHash } }),
    ]);

    if (!intent || !blockchain) {
      // Nothing to verify against; retrying cannot change that.
      throw new UnrecoverableError(
        `intent=${intentId} or blockchain=${blockchainId} no longer exists`,
      );
    }
    if (row?.verifiedAt) {
      this.logger.log(
        `[onchain-settlement] intent=${intentId} already verified; done`,
      );
      return;
    }
    if (intent.status !== "QUOTED" && intent.status !== "SIGNED") {
      this.logger.log(
        `[onchain-settlement] intent=${intentId} is ${intent.status}; nothing to do`,
      );
      return;
    }

    try {
      await this.intents.verifyOnchainPayment({ intent, blockchain, txHash });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? String(err);
      const outcome = classifySettlementError(err);

      if (outcome === "transient") {
        await this.intents.recordOnchainAttempt({
          intentId,
          txHash,
          blockchain,
          failureCode: TRANSIENT,
          failureMessage: message,
        });
        this.logger.warn(
          `[onchain-settlement] transient intent=${intentId} txHash=${txHash} attempt=${attempt}: ${message}`,
        );
        // Let BullMQ apply the long backoff; `onFailed` handles the case
        // where the whole budget is spent.
        throw err;
      }

      this.logger.warn(
        `[onchain-settlement] ${outcome} intent=${intentId} txHash=${txHash}: ${message}`,
      );
      await this.intents.markOnchainSettlementIssue({
        intentId,
        txHash,
        blockchain,
        outcome,
        message,
      });
      // A chain verdict is final for this hash; do not retry.
      return;
    }

    await this.intents.finalizeOnchainSettlement({
      intent,
      blockchain,
      txHash,
    });
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<OnchainSettlementJobData> | undefined, err: Error) {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? SETTLEMENT_MAX_ATTEMPTS;
    if (err instanceof UnrecoverableError) return;
    if (job.attemptsMade < maxAttempts) return;

    // Every retry came back transient. We still do not know what the
    // chain thinks, so this is a review, not a failure.
    const { intentId, txHash, blockchainId } = job.data;
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: blockchainId },
      select: { chainId: true, solanaCluster: true },
    });
    this.logger.error(
      `[onchain-settlement] retry budget spent intent=${intentId} txHash=${txHash}: ${err.message}`,
    );
    await this.intents.markOnchainSettlementIssue({
      intentId,
      txHash,
      blockchain: blockchain ?? { chainId: null, solanaCluster: null },
      outcome: "rejected_mismatch",
      message: `No chain verdict after ${maxAttempts} attempts: ${err.message}`,
    });
  }
}
