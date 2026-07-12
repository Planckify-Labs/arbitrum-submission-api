import type { ConfigService } from "@nestjs/config";
import type { BlockchainVerificationService } from "../../../blockchain-verification/blockchain-verification.service";
import type { PrismaService } from "../../../prisma/prisma.service";
import { SettlementRejectedError } from "../settlement.types";
import type { SettleArgs, PayerInput } from "../settlement.types";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import { OnchainSettlementProvider } from "./onchain.settlement.provider";
import { BadRequestException } from "@nestjs/common";

/**
 * Unit tests for OnchainSettlementProvider (task 22).
 *
 * Covers all branches from spec ss8 (Failure Semantics):
 *  - Happy path: valid tx -> SETTLED
 *  - Idempotency: same (intentId, txHash) -> returns prior row
 *  - payerInput.kind !== "txHash" -> SettlementRejectedError
 *  - Intent already SETTLED -> SettlementRejectedError
 *  - waitForTransactionReceipt timeout -> SETTLING (in-flight)
 *  - Receipt status reverted -> FAILED with TX_REVERTED
 *  - Sender mismatch -> FAILED with SENDER_MISMATCH
 *  - Recipient mismatch -> FAILED with RECIPIENT_MISMATCH
 *  - getMerchantPaymentByRef returns zero-struct -> FAILED with REF_NOT_ON_CHAIN
 *  - Field mismatch on MerchantPayment struct -> FAILED with CONTRACT_DATA_MISMATCH
 *  - Chain has no "takumi_pay" SmartContract row -> SettlementRejectedError
 *  - Payer has no wallet address -> SettlementRejectedError
 *
 * Follows the xendit-payout.provider.spec.ts pattern: direct instantiation
 * with mock dependencies rather than NestJS Test.createTestingModule.
 */

const TX_HASH = `0x${"ab".repeat(32)}`;
const CHAIN_ID = 5042002;
const PAYER_WALLET = "0x1111111111111111111111111111111111111111";
const CONTRACT_ADDR = "0x2222222222222222222222222222222222222222";
const TOKEN_ADDR = "0x3600000000000000000000000000000000000000";

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_01HXYZ",
    status: "QUOTED",
    path: "direct_arc",
    payerUserId: "user_payer",
    merchantId: "mch_123",
    sourceTokenAddress: TOKEN_ADDR,
    tokenAmountMinor: 6_350_000n,
    fiatAmountMinor: 100_000,
    fiatCurrency: "IDR",
    exchangeRateId: 42,
    sourceChainId: CHAIN_ID,
    ...overrides,
  } as unknown as PaymentIntent;
}

function makeMerchant() {
  return {
    id: "mch_123",
    payoutProvider: "xendit",
  } as unknown as Merchant;
}

function makeTxHashInput(overrides: Partial<{ txHash: string; chainId: number }> = {}): PayerInput {
  return {
    kind: "txHash",
    txHash: overrides.txHash ?? TX_HASH,
    chainId: overrides.chainId ?? CHAIN_ID,
  };
}

function makeSettleArgs(overrides: {
  intent?: PaymentIntent;
  merchant?: Merchant;
  payerInput?: PayerInput;
} = {}): SettleArgs {
  return {
    intent: overrides.intent ?? makeIntent(),
    merchant: overrides.merchant ?? makeMerchant(),
    payerInput: overrides.payerInput ?? makeTxHashInput(),
  };
}

function configStub(): Pick<ConfigService, "get"> {
  return {
    get: jest.fn((k: string, defaultVal?: unknown) => {
      if (k === "ONCHAIN_MIN_CONFIRMATIONS") return 12;
      if (k === "MIN_CONFIRMATIONS") return 12;
      return defaultVal;
    }),
  } as unknown as ConfigService;
}

function buildMocks() {
  const mockBlockchainVerification: jest.Mocked<
    Pick<BlockchainVerificationService, "verifyTxReceiptOnly" | "verifyMerchantPaymentInContract">
  > = {
    verifyTxReceiptOnly: jest.fn().mockResolvedValue({
      receipt: { status: "success", blockNumber: 100n },
      transaction: { from: PAYER_WALLET, to: CONTRACT_ADDR, chainId: CHAIN_ID },
      confirmations: 12,
    }),
    verifyMerchantPaymentInContract: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrisma = {
    onchainSettlement: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "os_01",
        intentId: args.data.intentId,
        txHash: args.data.txHash,
        chainId: args.data.chainId,
        verifiedAt: args.data.verifiedAt ?? null,
        failureCode: args.data.failureCode ?? null,
        failureMessage: args.data.failureMessage ?? null,
        createdAt: new Date(),
      })),
    },
    paymentIntent: {
      update: jest.fn(async (args: { where: { id: unknown }; data: Record<string, unknown> }) => ({ id: args.where.id, ...args.data })),
    },
    blockchain: {
      findFirstOrThrow: jest.fn(async () => ({
        id: "bc_evm",
        chainId: CHAIN_ID,
        isActive: true,
        type: "EVM",
        minConfirmations: null,
      })),
    },
    smartContract: {
      findFirst: jest.fn(async () => ({ address: CONTRACT_ADDR })),
    },
    user: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: "user_payer",
        walletAddress: PAYER_WALLET,
      })),
    },
    token: {
      findUnique: jest.fn(async () => ({
        id: "tok_usdc",
        contractAddress: TOKEN_ADDR,
      })),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  };

  const mockConfig = configStub();

  return { mockBlockchainVerification, mockPrisma, mockConfig };
}

function buildProvider(overrides?: {
  bv?: unknown;
  prisma?: unknown;
  config?: unknown;
}) {
  const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
  return {
    provider: new OnchainSettlementProvider(
      (overrides?.bv ?? mockBlockchainVerification) as unknown as BlockchainVerificationService,
      (overrides?.prisma ?? mockPrisma) as unknown as PrismaService,
      (overrides?.config ?? mockConfig) as unknown as ConfigService,
    ),
    bv: (overrides?.bv ?? mockBlockchainVerification) as typeof mockBlockchainVerification,
    prisma: (overrides?.prisma ?? mockPrisma) as typeof mockPrisma,
    config: (overrides?.config ?? mockConfig) as typeof mockConfig,
  };
}

describe("OnchainSettlementProvider", () => {
  it("happy path: valid tx -> SETTLED", async () => {
    const { provider, prisma, bv } = buildProvider();
    const result = await provider.settle(makeSettleArgs());

    expect(result.status).toBe("SETTLED");
    expect(result.settlementId).toBe("os_01");
    expect(result.txHash).toBe(TX_HASH);
    expect(bv.verifyTxReceiptOnly).toHaveBeenCalledTimes(1);
    expect(bv.verifyMerchantPaymentInContract).toHaveBeenCalledTimes(1);
    expect(prisma.onchainSettlement.create).toHaveBeenCalledTimes(1);
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pi_01HXYZ" },
        data: { status: "SETTLED" },
      }),
    );
  });

  it("idempotency: same (intentId, txHash) returns prior row without re-verification", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    const existingRow = {
      id: "os_EXISTING",
      intentId: "pi_01HXYZ",
      txHash: TX_HASH,
      chainId: CHAIN_ID,
      verifiedAt: new Date(),
      failureCode: null,
      failureMessage: null,
      createdAt: new Date(),
    };
    mockPrisma.onchainSettlement.findFirst.mockResolvedValue(existingRow);

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });
    const result = await provider.settle(makeSettleArgs());

    expect(result.settlementId).toBe("os_EXISTING");
    expect(result.status).toBe("SETTLED");
    // Critical: no on-chain verification or DB writes on replay
    expect(mockBlockchainVerification.verifyTxReceiptOnly).not.toHaveBeenCalled();
    expect(mockBlockchainVerification.verifyMerchantPaymentInContract).not.toHaveBeenCalled();
    expect(mockPrisma.onchainSettlement.create).not.toHaveBeenCalled();
  });

  it("payerInput.kind !== 'txHash' -> SettlementRejectedError", async () => {
    const { provider } = buildProvider();
    const args = makeSettleArgs({
      payerInput: { kind: "signature", signature: "0xdeadbeef" },
    });

    await expect(provider.settle(args)).rejects.toBeInstanceOf(
      SettlementRejectedError,
    );
    await expect(provider.settle(args)).rejects.toMatchObject({
      code: "PAYER_INPUT_WRONG_KIND",
    });
  });

  it("intent already SETTLED -> SettlementRejectedError", async () => {
    const { provider } = buildProvider();
    const args = makeSettleArgs({
      intent: makeIntent({ status: "SETTLED" }),
    });

    await expect(provider.settle(args)).rejects.toBeInstanceOf(
      SettlementRejectedError,
    );
    await expect(provider.settle(args)).rejects.toMatchObject({
      code: "INTENT_ALREADY_SETTLED",
    });
  });

  it("waitForTransactionReceipt timeout -> SETTLING (in-flight)", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    const timeoutError = new Error("waitForTransactionReceipt timeout after 60000ms");
    timeoutError.name = "TimeoutError";
    mockBlockchainVerification.verifyTxReceiptOnly.mockRejectedValue(timeoutError);

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });
    const result = await provider.settle(makeSettleArgs());

    expect(result.status).toBe("SETTLING");
    // No DB settlement row created on timeout -- intent stays in-flight
    expect(mockPrisma.paymentIntent.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
  });

  it("receipt status reverted -> FAILED with TX_REVERTED", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockBlockchainVerification.verifyTxReceiptOnly.mockRejectedValue(
      new BadRequestException("Transaction was reverted or failed"),
    );

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await expect(provider.settle(makeSettleArgs())).rejects.toMatchObject({
      code: "TX_REVERTED",
    });
  });

  it("sender mismatch -> FAILED with SENDER_MISMATCH", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockBlockchainVerification.verifyTxReceiptOnly.mockRejectedValue(
      new BadRequestException("Sender address mismatch"),
    );

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await expect(provider.settle(makeSettleArgs())).rejects.toMatchObject({
      code: "SENDER_MISMATCH",
    });
  });

  it("recipient mismatch -> FAILED with RECIPIENT_MISMATCH", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockBlockchainVerification.verifyTxReceiptOnly.mockRejectedValue(
      new BadRequestException("Recipient address mismatch"),
    );

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await expect(provider.settle(makeSettleArgs())).rejects.toMatchObject({
      code: "RECIPIENT_MISMATCH",
    });
  });

  it("getMerchantPaymentByRef returns zero-struct -> FAILED with REF_NOT_ON_CHAIN", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockBlockchainVerification.verifyMerchantPaymentInContract.mockRejectedValue(
      new BadRequestException(
        "Merchant payment refId mismatch: expected pi_01HXYZ, got ",
      ),
    );

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await expect(provider.settle(makeSettleArgs())).rejects.toMatchObject({
      code: "REF_NOT_ON_CHAIN",
    });
  });

  it("field mismatch on MerchantPayment struct -> FAILED with CONTRACT_DATA_MISMATCH", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockBlockchainVerification.verifyMerchantPaymentInContract.mockRejectedValue(
      new BadRequestException(
        "Merchant payment amount mismatch: expected 6350000, got 1000000",
      ),
    );

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await expect(provider.settle(makeSettleArgs())).rejects.toMatchObject({
      code: "CONTRACT_DATA_MISMATCH",
    });
  });

  it("chain has no takumi_pay SmartContract row -> SettlementRejectedError", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockPrisma.smartContract.findFirst.mockResolvedValue(null);

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await expect(provider.settle(makeSettleArgs())).rejects.toBeInstanceOf(
      SettlementRejectedError,
    );
    await expect(provider.settle(makeSettleArgs())).rejects.toMatchObject({
      code: "NO_CONTRACT",
    });
  });

  it("payer has no wallet address -> SettlementRejectedError", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      id: "user_payer",
      walletAddress: null,
    });

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await expect(provider.settle(makeSettleArgs())).rejects.toBeInstanceOf(
      SettlementRejectedError,
    );
    await expect(provider.settle(makeSettleArgs())).rejects.toMatchObject({
      code: "PAYER_NO_WALLET",
    });
  });

  it("uses per-chain minConfirmations when available on blockchain row", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();
    mockPrisma.blockchain.findFirstOrThrow.mockResolvedValue({
      id: "bc_evm",
      chainId: CHAIN_ID,
      isActive: true,
      type: "EVM",
      minConfirmations: 90,
    });

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await provider.settle(makeSettleArgs());

    expect(mockBlockchainVerification.verifyTxReceiptOnly).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumConfirmations: 90,
      }),
    );
  });

  it("falls back to env-based minConfirmations when chain row has null", async () => {
    const { mockBlockchainVerification, mockPrisma, mockConfig } = buildMocks();

    const { provider } = buildProvider({
      bv: mockBlockchainVerification,
      prisma: mockPrisma,
      config: mockConfig,
    });

    await provider.settle(makeSettleArgs());

    expect(mockBlockchainVerification.verifyTxReceiptOnly).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumConfirmations: 12,
      }),
    );
  });
});
