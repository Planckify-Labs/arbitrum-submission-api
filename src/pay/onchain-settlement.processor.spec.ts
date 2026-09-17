// expo-server-sdk ships pure ESM; nothing here sends a push.
jest.mock("expo-server-sdk", () => ({ Expo: class {} }));

import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { PrismaService } from "../prisma/prisma.service";
import type {
  IntentsService,
  OnchainSettlementJobData,
} from "./intents.service";
import { OnchainSettlementProcessor } from "./onchain-settlement.processor";

describe("OnchainSettlementProcessor — what the user is told, and when", () => {
  const intentId = "01M2PRX5BA34H2ZES9EPBN3GNQ";
  const txHash = `0x${"ab".repeat(32)}`;
  const data: OnchainSettlementJobData = {
    intentId,
    txHash,
    blockchainId: "monad-testnet",
  };

  function build(
    opts: {
      verify?: jest.Mock;
      intentStatus?: string;
      verifiedAt?: Date | null;
    } = {},
  ) {
    const prisma = {
      paymentIntent: {
        findUnique: jest.fn(async () => ({
          id: intentId,
          status: opts.intentStatus ?? "SIGNED",
          merchant: { displayName: "GTron" },
          payer: null,
        })),
      },
      blockchain: {
        findUnique: jest.fn(async () => ({
          id: "monad-testnet",
          type: "EVM",
          chainId: 10143,
          solanaCluster: null,
        })),
      },
      onchainSettlement: {
        findFirst: jest.fn(async () => ({
          verifiedAt: opts.verifiedAt ?? null,
        })),
      },
    };
    const intents = {
      verifyOnchainPayment:
        opts.verify ?? jest.fn(async () => ({ payer: "0xp" })),
      finalizeOnchainSettlement: jest.fn(async () => true),
      markOnchainSettlementIssue: jest.fn(async () => undefined),
      recordOnchainAttempt: jest.fn(async () => undefined),
    };
    const processor = new OnchainSettlementProcessor(
      prisma as unknown as PrismaService,
      intents as unknown as IntentsService,
    );
    return { processor, prisma, intents };
  }

  const job = (attemptsMade = 0, attempts = 150) =>
    ({
      data,
      attemptsMade,
      opts: { attempts },
    }) as unknown as Job<OnchainSettlementJobData>;

  it("verified → finalize (payout, activity, push) and done", async () => {
    const { processor, intents } = build();
    await processor.process(job());
    expect(intents.finalizeOnchainSettlement).toHaveBeenCalledTimes(1);
    expect(intents.markOnchainSettlementIssue).not.toHaveBeenCalled();
  });

  it("transient (rpc down / no receipt yet): records the attempt, tells the user NOTHING, and rethrows so BullMQ retries", async () => {
    const err = new Error("Unsupported chain ID: 10143");
    const { processor, intents } = build({
      verify: jest.fn(() => Promise.reject(err)),
    });
    await expect(processor.process(job(3))).rejects.toBe(err);
    expect(intents.recordOnchainAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "TRANSIENT" }),
    );
    expect(intents.markOnchainSettlementIssue).not.toHaveBeenCalled();
    expect(intents.finalizeOnchainSettlement).not.toHaveBeenCalled();
  });

  it("chain says reverted: terminal on the first attempt, no retry, user told 'not charged'", async () => {
    const { processor, intents } = build({
      verify: jest.fn(() =>
        Promise.reject(new Error("Transaction 0xab was reverted or failed")),
      ),
    });
    await expect(processor.process(job(0))).resolves.toBeUndefined();
    expect(intents.markOnchainSettlementIssue).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected_reverted" }),
    );
    expect(intents.finalizeOnchainSettlement).not.toHaveBeenCalled();
  });

  it("mined but mismatched: terminal, needs review, no retry", async () => {
    const { processor, intents } = build({
      verify: jest.fn(() =>
        Promise.reject(
          new Error("Merchant payment amount mismatch: expected 1, got 2"),
        ),
      ),
    });
    await expect(processor.process(job(0))).resolves.toBeUndefined();
    expect(intents.markOnchainSettlementIssue).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected_mismatch" }),
    );
  });

  it("onFailed: earlier attempts stay silent; only a spent budget becomes 'we're checking' (never 'failed')", async () => {
    const { processor, intents } = build();
    const err = new Error("HTTP request failed");

    await processor.onFailed(job(5, 150), err);
    expect(intents.markOnchainSettlementIssue).not.toHaveBeenCalled();

    await processor.onFailed(job(150, 150), err);
    expect(intents.markOnchainSettlementIssue).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected_mismatch" }),
    );

    intents.markOnchainSettlementIssue.mockClear();
    await processor.onFailed(job(150, 150), new UnrecoverableError("gone"));
    expect(intents.markOnchainSettlementIssue).not.toHaveBeenCalled();
  });

  it("already verified or already terminal: no-op", async () => {
    const a = build({ verifiedAt: new Date() });
    await a.processor.process(job());
    expect(a.intents.verifyOnchainPayment).not.toHaveBeenCalled();

    const b = build({ intentStatus: "SETTLED" });
    await b.processor.process(job());
    expect(b.intents.verifyOnchainPayment).not.toHaveBeenCalled();
  });
});
