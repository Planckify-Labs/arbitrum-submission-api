/**
 * Async-claim watcher — the pending-claims tracker for ERC-7540 vaults
 * (docs/defi-evm-protocol-expansion-spec.md §7, requirement 2).
 *
 * An async vault settles as `request → (off-chain fulfil) → claim`. The claim
 * is a SECOND transaction the user has to send, potentially days later, and
 * nothing on-chain will remind them. Without this worker a requested deposit
 * simply stops being visible: funds committed, no position, no prompt. That is
 * the failure mode §7 forbids and the reason the async resolver stays
 * unregistered until this loop is proven.
 *
 * The worker scans positions parked in a `*_requested` phase, reads the
 * vault's own `claimableDepositRequest` / `claimableRedeemRequest`, and flips
 * them to `*_claimable` once fulfilment lands. The flip is what the app renders
 * as "ready to claim" and what the notification hangs off.
 *
 * Fail-safe in one direction only: an unreadable vault leaves the position
 * pending. We never mark something claimable we could not confirm — a false
 * "ready" shows a claim button that reverts.
 */

import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { parseAbi } from "viem";
import { PrismaService } from "../../prisma/prisma.service";
import { getPublicClientForChain } from "../targets/rpc";
import type { DepositTarget } from "../targets/types";
import { resolveEvmChainId } from "../targets/types";

export const ASYNC_PHASE = {
  depositRequested: "deposit_requested",
  depositClaimable: "deposit_claimable",
  redeemRequested: "redeem_requested",
  redeemClaimable: "redeem_claimable",
} as const;

const ERC7540_VIEW_ABI = parseAbi([
  "function claimableDepositRequest(uint256 requestId, address controller) view returns (uint256)",
  "function claimableRedeemRequest(uint256 requestId, address controller) view returns (uint256)",
]);

@Processor("async-claim-watcher")
export class AsyncClaimWatcherProcessor extends WorkerHost {
  private readonly logger = new Logger(AsyncClaimWatcherProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const pending = await this.prisma.strategyPosition.findMany({
      where: {
        status: "active",
        asyncPhase: {
          in: [ASYNC_PHASE.depositRequested, ASYNC_PHASE.redeemRequested],
        },
      },
      select: {
        id: true,
        walletAddress: true,
        chainId: true,
        chainName: true,
        poolId: true,
        asyncPhase: true,
        asyncRequestId: true,
      },
    });
    if (pending.length === 0) return;

    let becameClaimable = 0;
    for (const position of pending) {
      try {
        const claimable = await this.readClaimable(position);
        // `null` = could not read. Leave it pending and try again next tick.
        if (claimable === null) continue;
        await this.prisma.strategyPosition.update({
          where: { id: position.id },
          data: {
            asyncCheckedAt: new Date(),
            ...(claimable > 0n
              ? {
                  asyncPhase:
                    position.asyncPhase === ASYNC_PHASE.depositRequested
                      ? ASYNC_PHASE.depositClaimable
                      : ASYNC_PHASE.redeemClaimable,
                }
              : {}),
          },
        });
        if (claimable > 0n) {
          becameClaimable++;
          // Notification dispatch hooks in here, keyed off the phase flip so
          // the user is told exactly once per request.
          this.logger.log(
            `[async-claim] position=${position.id} is now claimable (${position.asyncPhase})`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[async-claim] position=${position.id} check failed: ${
            (err as Error)?.message ?? err
          } — leaving pending`,
        );
      }
    }

    this.logger.log(
      `[async-claim] scan complete. pending=${pending.length} became_claimable=${becameClaimable}`,
    );
  }

  /**
   * Read the vault's claimable amount for this request, or `null` when we
   * cannot (no target, unreachable chain, revert).
   */
  private async readClaimable(position: {
    walletAddress: string;
    chainName: string;
    poolId: string | null;
    asyncPhase: string | null;
    asyncRequestId: string | null;
  }): Promise<bigint | null> {
    if (!position.poolId) return null;
    const row = await this.prisma.opportunityCache.findUnique({
      where: { poolId: position.poolId },
      select: { depositTarget: true },
    });
    const target = row?.depositTarget as DepositTarget | null;
    if (!target || target.kind !== "async-vault") return null;

    const chainId = resolveEvmChainId(position.chainName);
    const client = getPublicClientForChain(chainId);
    if (!client) return null;

    const requestId = BigInt(position.asyncRequestId ?? "0");
    const fn =
      position.asyncPhase === ASYNC_PHASE.depositRequested
        ? "claimableDepositRequest"
        : "claimableRedeemRequest";
    try {
      return await client.readContract({
        address: target.vault,
        abi: ERC7540_VIEW_ABI,
        functionName: fn,
        args: [requestId, position.walletAddress as `0x${string}`],
      });
    } catch {
      return null;
    }
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Async claim watcher job ${job.id} completed`);
  }
}
