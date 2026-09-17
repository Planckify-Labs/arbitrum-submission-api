import type { ConfigService } from "@nestjs/config";

/**
 * Shared policy for anything that verifies a user's on-chain payment after
 * the fact (merchant settlement, point deposits): how long to wait for the
 * chain, how to retry, and — the part that decides what the user is told —
 * how to classify a failure.
 *
 * The rule: the user is told "failed" only when the CHAIN said so. A
 * failure on our side (RPC unreachable, receipt not yet available, chain
 * client not registered, DB hiccup) is never a payment failure — the user
 * already paid on-chain — so it is retried silently for a long time. Only
 * a receipt that says "reverted" (nothing moved) or a mined tx that does
 * not match what was quoted (moved, but not as agreed) ends the retries,
 * and each of those gets its own, honest message.
 */

export type SettlementOutcome =
  /** No chain verdict yet, or our side broke. Retry, say nothing. */
  | "transient"
  /** Receipt says reverted: nothing moved, the user was not charged. */
  | "rejected_reverted"
  /** Mined and succeeded, but not the payment that was quoted. Ops reviews. */
  | "rejected_mismatch";

const REVERTED = /reverted or failed/i;
const MISMATCH = /mismatch|did not process merchant payment/i;

/**
 * Only two message families count as a chain verdict: a receipt that
 * says reverted, and a mined record whose fields don't match the quote
 * (or a receipt with no `MerchantPaymentProcessed` log for this intent).
 * Everything else — including "account does not exist" / "not found
 * on-chain" from Solana/Stellar, which usually just means "not confirmed
 * yet", and "insufficient confirmations" from a lagging node — is
 * transient by design: the cost of a wrong "transient" is a delayed
 * confirmation, the cost of a wrong "rejected" is telling someone who
 * paid that they didn't.
 */
export function classifySettlementError(err: unknown): SettlementOutcome {
  const message = (err as { message?: string })?.message ?? String(err);
  if (REVERTED.test(message)) return "rejected_reverted";
  if (MISMATCH.test(message)) return "rejected_mismatch";
  return "transient";
}

/**
 * Confirmation depth for a chain: its own `Blockchain.minConfirmations`
 * first, then the env defaults. Same resolution order everywhere so a
 * per-chain setting (Monad = 1, MonadBFT finality) is honoured by every
 * verifier, not just one.
 */
export function resolveMinConfirmations(
  blockchain: { minConfirmations?: number | null },
  config: Pick<ConfigService, "get">,
): number {
  const candidates = [
    blockchain.minConfirmations,
    config.get<string | number>("ONCHAIN_MIN_CONFIRMATIONS"),
    config.get<string | number>("MIN_CONFIRMATIONS"),
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (c != null && c !== "" && Number.isInteger(n) && n >= 0) return n;
  }
  return 12;
}

/**
 * Retry schedule for transient failures: 5s, 10s, 20s, … capped at 10
 * minutes, for roughly a day in total. Long enough to ride out an RPC or
 * api outage without ever telling the user anything went wrong; a job
 * that is STILL transient after this is handed to ops as "needs review",
 * not marked failed.
 */
export const SETTLEMENT_BACKOFF_BASE_MS = 5_000;
export const SETTLEMENT_BACKOFF_CAP_MS = 10 * 60_000;
export const SETTLEMENT_MAX_ATTEMPTS = 150;

export function settlementBackoffMs(attemptsMade: number): number {
  const exp = Math.max(0, attemptsMade - 1);
  // Guard the shift: 2 ** 60 is fine as a float, but keep it explicit.
  const raw = SETTLEMENT_BACKOFF_BASE_MS * 2 ** Math.min(exp, 20);
  return Math.min(raw, SETTLEMENT_BACKOFF_CAP_MS);
}

/** BullMQ `settings.backoffStrategy` for queues using `backoff: { type: "custom" }`. */
export const settlementBackoffStrategy = (attemptsMade: number): number =>
  settlementBackoffMs(attemptsMade);

/** Job options for a verification job on any settlement queue. */
export const SETTLEMENT_JOB_OPTIONS = {
  attempts: SETTLEMENT_MAX_ATTEMPTS,
  backoff: { type: "custom" as const },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

/** Row/metadata marker for "handed to ops, user told we're still checking". */
export const NEEDS_REVIEW = "NEEDS_REVIEW";
export const TX_REVERTED = "TX_REVERTED";
export const TRANSIENT = "TRANSIENT";
