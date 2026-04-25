import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { ValkeyService } from "../valkey/valkey.service";
import type { X402SupportedService } from "../x402/x402-supported.service";
import type { ICircleSettleSvmClient } from "./circle-settle-svm.client";
import { IntentsService } from "./intents.service";

/**
 * Task 43 — SVM facilitator backend tests.
 *
 * Covers:
 *  - `createIntent` with `preferredChain: "solana"` → builds an SVM nanopay
 *    block with the Solana treasury and CAIP-2 network.
 *  - `submitNanopaySvm` happy path (facilitator 200 → SETTLED).
 *  - `submitNanopaySvm` on an EVM intent → 400 INTENT_WRONG_CHAIN_NAMESPACE.
 *  - `submitNanopaySvm` with facilitator 5xx → FAILED with CIRCLE_UPSTREAM_ERROR.
 *
 * Circle's facilitator is NEVER actually called (task 43 Constraints:
 * "Do NOT actually call Circle's facilitator in tests — mock"). We inject
 * a stub `ICircleSettleSvmClient` that returns canned outcomes.
 */

const SVM_MAINNET_SENTINEL = -101;
const SVM_TREASURY_PUBKEY = "7xKXq3cU2pSoxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const PAYER_SVM_PUBKEY = "PayerPubKey11111111111111111111111111111111";

function x402Stub() {
  // A Solana entry under `solana:mainnet`. The EVM path is unused in SVM
  // tests but we still respond for chainId 5042002 to keep the stub
  // interchangeable across suites.
  const svmEntry = {
    namespace: "solana" as const,
    chainId: null,
    network: "solana:mainnet",
    scheme: "exact",
    asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    domainName: null,
    domainVersion: null,
    verifyingContract: null,
    authorizedSigners: ["FacilitatorFeePayer11111111111111111111111111"],
  };
  const evmEntry = {
    namespace: "eip155" as const,
    chainId: 5042002,
    network: "eip155:5042002",
    scheme: "exact",
    asset: "0x3600000000000000000000000000000000000000",
    domainName: "GatewayWalletBatched",
    domainVersion: "1",
    verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9",
    authorizedSigners: [],
  };
  return {
    getSupportedForChain: jest.fn((chainId: number) =>
      chainId === 5042002 ? evmEntry : null,
    ),
    getSupportedForNetwork: jest.fn((network: string) =>
      network === "solana:mainnet" || network === "solana:mainnet-beta"
        ? svmEntry
        : null,
    ),
  } as unknown as X402SupportedService;
}

function valkeyStub(): Pick<ValkeyService, "get" | "set"> {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k: string, v: unknown) => {
      store.set(k, v);
      return true;
    }),
  } as any;
}

function configStub(env: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn(<T,>(key: string, fallback?: T): T | undefined => {
      const raw = env[key];
      if (raw === undefined || raw === "") return fallback;
      return raw as unknown as T;
    }),
  } as unknown as ConfigService;
}

function svmPrismaStub(opts?: {
  intent?: Record<string, unknown> | null;
  existingSubmission?: Record<string, unknown> | null;
  blockchain?: {
    id: string;
    chainSlug: string;
    isActive: boolean;
    isEVM: boolean;
    x402FacilitatorUrl?: string | null;
  } | null;
  createdIntent?: Record<string, unknown>;
  merchant?: Record<string, unknown> | null;
  fxRow?: Record<string, unknown> | null;
}) {
  const intent = opts?.intent;
  const existingSubmission = opts?.existingSubmission ?? null;
  const blockchain =
    opts?.blockchain === undefined
      ? {
          id: "bc_solana_mainnet",
          chainSlug: "solana-mainnet",
          isActive: true,
          isEVM: false,
          x402FacilitatorUrl: "https://facilitator.example/v1/settle",
        }
      : opts.blockchain;
  const createdIntent = opts?.createdIntent ?? {
    id: "pi_svm_01",
    status: "QUOTED",
    nanopayUsdcAmountMicros: 941_294n,
    nanopayUsdcSourceChainId: SVM_MAINNET_SENTINEL,
    nanopayUsdcTreasuryAddress: SVM_TREASURY_PUBKEY,
    nanopayNonce: Buffer.alloc(32, 0x22),
    nanopayValidAfter: 1_700_000_000,
    nanopayValidBefore: 1_700_262_600,
    expiresAt: new Date("2026-04-23T01:10:00Z"),
    fiatCurrency: "IDR",
  };
  const merchant = opts?.merchant ?? { id: "mch_123", isActive: true };
  const fxRow =
    opts?.fxRow === undefined
      ? {
          id: 1,
          createdAt: new Date("2026-04-20T00:00:00Z"),
          rate: { toString: () => "15700" },
          markup: { toString: () => "1.5" },
          fromCurrency: "USDC",
          toCurrency: "IDR",
          provider: "CoinGecko",
          sourceProvider: { name: "CoinGecko" },
        }
      : opts.fxRow;

  const nanopaySubmissionCreate = jest.fn(async (args: any) => ({
    id: "sub_svm_01",
    intentId: args.data.intentId,
    signature: args.data.signature,
    submittedAt: args.data.submittedAt,
    circleSettleTxUuid: args.data.circleSettleTxUuid ?? null,
    circleSettleResponseReceivedAt:
      args.data.circleSettleResponseReceivedAt ?? null,
    circleSettleNetwork: args.data.circleSettleNetwork ?? null,
    failureCode: args.data.failureCode ?? null,
    failureMessage: args.data.failureMessage ?? null,
  }));
  const paymentIntentUpdate = jest.fn(async (args: any) => ({
    ...(intent ?? {}),
    status: args.data.status,
  }));

  const $transaction = jest.fn(async (cb: any) =>
    cb({
      nanopaySubmission: { create: nanopaySubmissionCreate },
      paymentIntent: { update: paymentIntentUpdate },
    }),
  );

  return {
    paymentIntent: {
      findUnique: jest.fn(async () => intent ?? null),
      create: jest.fn(async () => createdIntent),
      update: paymentIntentUpdate,
    },
    nanopaySubmission: {
      findFirst: jest.fn(async () => existingSubmission),
      create: nanopaySubmissionCreate,
    },
    merchant: { findUnique: jest.fn(async () => merchant) },
    exchangeRate: { findFirst: jest.fn(async () => fxRow) },
    blockchain: { findUnique: jest.fn(async () => blockchain) },
    $transaction,
  };
}

function evmCircleSettleStub() {
  return {
    settle: jest.fn().mockResolvedValue({
      kind: "ok",
      response: {
        success: true,
        transaction: "evm-tx",
        network: "eip155:5042002",
      },
      rawBody: {},
    }),
  };
}

function buildSvmService(overrides: {
  prisma: ReturnType<typeof svmPrismaStub>;
  svmSettle?: ICircleSettleSvmClient;
  env?: Record<string, string | undefined>;
}) {
  const prisma = overrides.prisma;
  const svmSettle =
    overrides.svmSettle ??
    ({
      settle: jest.fn().mockResolvedValue({
        kind: "ok",
        response: {
          success: true,
          transaction: "svm-sig-base58",
          network: "solana:mainnet",
        },
        rawBody: {},
      }),
    } as unknown as ICircleSettleSvmClient);
  const env: Record<string, string | undefined> = {
    PLATFORM_TREASURY_ADDRESS_EVM: "0x00000000000000000000000000000000abCDef01",
    PLATFORM_TREASURY_ADDRESS_SVM: SVM_TREASURY_PUBKEY,
    ...(overrides.env ?? {}),
  };

  const bcCache = {
    getByChainId: jest.fn(async (_chainId: number, fallback: () => Promise<unknown>) => fallback()),
    getByChainSlug: jest.fn(async (_slug: string, fallback: () => Promise<unknown>) => fallback()),
  };

  const svc = new IntentsService(
    prisma as unknown as PrismaService,
    valkeyStub() as unknown as ValkeyService,
    bcCache as any,
    x402Stub(),
    configStub(env),
    evmCircleSettleStub() as any,
    null,
    null,
    svmSettle,
  );
  return { svc, prisma, svmSettle };
}

describe("IntentsService.createIntent (SVM)", () => {
  const defaultArgs = {
    idempotencyKey: "b".repeat(32),
    payerAddress: PAYER_SVM_PUBKEY,
    payerUserId: "user_svm",
    rawBodyForHash:
      '{"currency":"IDR","fiatAmountMinor":15000,"merchantId":"mch_123","preferredChain":"solana"}',
  };

  const svmDto = {
    merchantId: "mch_123",
    fiatAmountMinor: 15_000,
    currency: "IDR" as const,
    preferredChain: "solana" as const,
  };

  it("mints an SVM intent with the Solana treasury + sentinel chainId", async () => {
    const prisma = svmPrismaStub();
    const { svc } = buildSvmService({ prisma });
    const result = await svc.createIntent({ dto: svmDto, ...defaultArgs });

    expect(result.nanopayUsdcSourceChainId).toBe(SVM_MAINNET_SENTINEL);
    expect(result.nanopayUsdcTreasuryAddress).toBe(SVM_TREASURY_PUBKEY);
    expect(result.nanopay?.kind).toBe("svm_partial_tx");
    expect(result.nanopay?.cluster).toBe("mainnet-beta");
    expect(result.nanopay?.usdcMint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    // Persisted row: nanopayUsdcSourceChainId is the sentinel, NOT the EVM chainId.
    expect(prisma.paymentIntent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nanopayUsdcSourceChainId: SVM_MAINNET_SENTINEL,
          nanopayUsdcTreasuryAddress: SVM_TREASURY_PUBKEY,
          requiresDeposit: false, // SVM intents don't require a Gateway deposit.
        }),
      }),
    );
  });

  it("503s when PLATFORM_TREASURY_ADDRESS_SVM is blank (pre-M6)", async () => {
    const prisma = svmPrismaStub();
    const { svc } = buildSvmService({
      prisma,
      env: { PLATFORM_TREASURY_ADDRESS_SVM: "" },
    });
    await expect(
      svc.createIntent({ dto: svmDto, ...defaultArgs }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("503s when x402FacilitatorUrl is null on the SVM blockchain row", async () => {
    const prisma = svmPrismaStub({
      blockchain: {
        id: "bc_solana_mainnet",
        chainSlug: "solana-mainnet",
        isActive: true,
        isEVM: false,
        x402FacilitatorUrl: null,
      },
    });
    const { svc } = buildSvmService({ prisma });
    await expect(
      svc.createIntent({ dto: svmDto, ...defaultArgs }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("falls back to EVM when preferredChain is omitted", async () => {
    const prisma = svmPrismaStub({
      createdIntent: {
        id: "pi_evm_01",
        status: "QUOTED",
        nanopayUsdcAmountMicros: 941_294n,
        nanopayUsdcSourceChainId: 5042002,
        nanopayUsdcTreasuryAddress: "0x00000000000000000000000000000000abCDef01",
        nanopayNonce: Buffer.alloc(32, 0x11),
        nanopayValidAfter: 1_700_000_000,
        nanopayValidBefore: 1_700_262_600,
        expiresAt: new Date("2026-04-23T01:10:00Z"),
        fiatCurrency: "IDR",
      },
    });
    const { svc } = buildSvmService({ prisma });
    const result = await svc.createIntent({
      dto: { merchantId: "mch_123", fiatAmountMinor: 15_000, currency: "IDR" as const },
      ...defaultArgs,
      payerAddress: "0x1111111111111111111111111111111111111111",
      rawBodyForHash:
        '{"currency":"IDR","fiatAmountMinor":15000,"merchantId":"mch_123"}',
    });
    expect(result.nanopayUsdcSourceChainId).toBe(5042002);
    expect(result.nanopay?.kind).toBe("evm_eip3009");
  });
});

describe("IntentsService.submitNanopaySvm", () => {
  function svmIntentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "pi_svm_01",
      status: "QUOTED" as const,
      payerUserId: "user_svm",
      merchantId: "mch_123",
      fiatAmountMinor: 15_000,
      fiatCurrency: "IDR",
      nanopayUsdcAmountMicros: 941_294n,
      nanopayUsdcSourceChainId: SVM_MAINNET_SENTINEL,
      nanopayUsdcTreasuryAddress: SVM_TREASURY_PUBKEY,
      nanopayNonce: Buffer.alloc(32, 0x22),
      nanopayValidAfter: 1_700_000_000,
      nanopayValidBefore: 1_700_262_600,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date("2026-04-20T00:00:00Z"),
      merchant: {
        id: "mch_123",
        displayName: "Warung Bu Tini",
        userId: "user_merchant",
      },
      payer: { id: "user_svm", walletAddress: PAYER_SVM_PUBKEY },
      ...overrides,
    };
  }

  const SIGNED_TX_BASE64 = Buffer.from(
    "dummy-signed-solana-tx-bytes".repeat(4),
  ).toString("base64");

  it("happy path: facilitator 200 OK → SETTLED + Solana signature persisted", async () => {
    const intent = svmIntentRow();
    const prisma = svmPrismaStub({ intent });
    const svmSettle = {
      settle: jest.fn().mockResolvedValue({
        kind: "ok",
        response: {
          success: true,
          transaction: "5xKuT8oXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          network: "solana:mainnet",
        },
        rawBody: {},
      }),
    } as unknown as ICircleSettleSvmClient;
    const { svc } = buildSvmService({ prisma, svmSettle });

    const result = await svc.submitNanopaySvm({
      intentId: "pi_svm_01",
      signedTransaction: SIGNED_TX_BASE64,
    });

    expect(result.status).toBe("SETTLED");
    expect((svmSettle as any).settle).toHaveBeenCalledTimes(1);
    // Intent flipped to SETTLED.
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SETTLED" } }),
    );
    // Submission row carries the Solana sig in the circleSettleTxUuid column.
    expect(prisma.nanopaySubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          circleSettleNetwork: "solana:mainnet",
        }),
      }),
    );
  });

  it("400s when the intent is an EVM intent (wrong chain namespace)", async () => {
    const intent = svmIntentRow({ nanopayUsdcSourceChainId: 5042002 });
    const prisma = svmPrismaStub({ intent });
    const svmSettle = {
      settle: jest.fn(),
    } as unknown as ICircleSettleSvmClient;
    const { svc } = buildSvmService({ prisma, svmSettle });

    await expect(
      svc.submitNanopaySvm({
        intentId: "pi_svm_01",
        signedTransaction: SIGNED_TX_BASE64,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // MUST NOT hit the facilitator on wrong-chain.
    expect((svmSettle as any).settle).not.toHaveBeenCalled();
  });

  it("404s when the intent is missing", async () => {
    const prisma = svmPrismaStub({ intent: null });
    const { svc } = buildSvmService({ prisma });
    await expect(
      svc.submitNanopaySvm({
        intentId: "pi_missing",
        signedTransaction: SIGNED_TX_BASE64,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("409s when the intent is terminal (already SETTLED)", async () => {
    const intent = svmIntentRow({ status: "SETTLED" });
    const prisma = svmPrismaStub({ intent });
    const svmSettle = {
      settle: jest.fn(),
    } as unknown as ICircleSettleSvmClient;
    const { svc } = buildSvmService({ prisma, svmSettle });
    await expect(
      svc.submitNanopaySvm({
        intentId: "pi_svm_01",
        signedTransaction: SIGNED_TX_BASE64,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((svmSettle as any).settle).not.toHaveBeenCalled();
  });

  it("facilitator 5xx → FAILED with CIRCLE_UPSTREAM_ERROR", async () => {
    const intent = svmIntentRow();
    const prisma = svmPrismaStub({ intent });
    const svmSettle = {
      settle: jest.fn().mockResolvedValue({
        kind: "upstream",
        status: 503,
        rawBody: null,
        message: "SVM facilitator 503 Service Unavailable",
      }),
    } as unknown as ICircleSettleSvmClient;
    const { svc } = buildSvmService({ prisma, svmSettle });

    const result = await svc.submitNanopaySvm({
      intentId: "pi_svm_01",
      signedTransaction: SIGNED_TX_BASE64,
    });

    expect(result.status).toBe("FAILED");
    expect(result.failure?.code).toBe("CIRCLE_UPSTREAM_ERROR");
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
  });

  it("facilitator timeout → SETTLING (intent flipped to SIGNED, NOT FAILED)", async () => {
    const intent = svmIntentRow();
    const prisma = svmPrismaStub({ intent });
    const svmSettle = {
      settle: jest.fn().mockResolvedValue({
        kind: "timeout",
        message: "SVM facilitator timed out after 30000ms",
      }),
    } as unknown as ICircleSettleSvmClient;
    const { svc } = buildSvmService({ prisma, svmSettle });

    const result = await svc.submitNanopaySvm({
      intentId: "pi_svm_01",
      signedTransaction: SIGNED_TX_BASE64,
    });
    expect(result.status).toBe("SETTLING");
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SIGNED" } }),
    );
  });

  it("503s with SVM_FACILITATOR_NOT_CONFIGURED when no SVM client is wired", async () => {
    const intent = svmIntentRow();
    const prisma = svmPrismaStub({ intent });
    const { svc } = buildSvmService({ prisma });
    // Clear the injected SVM client (simulates a pre-M6 module wiring).
    (svc as unknown as { circleSettleSvm: ICircleSettleSvmClient | null }).circleSettleSvm =
      null;

    await expect(
      svc.submitNanopaySvm({
        intentId: "pi_svm_01",
        signedTransaction: SIGNED_TX_BASE64,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("503s when the SVM blockchain row is missing / inactive / EVM", async () => {
    const intent = svmIntentRow();
    const prisma = svmPrismaStub({ intent, blockchain: null });
    const { svc } = buildSvmService({ prisma });
    await expect(
      svc.submitNanopaySvm({
        intentId: "pi_svm_01",
        signedTransaction: SIGNED_TX_BASE64,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("idempotent replay: same signedTransaction returns the existing row without re-calling the facilitator", async () => {
    const intent = svmIntentRow();
    const existing = {
      id: "sub_existing",
      intentId: "pi_svm_01",
      signature: Buffer.alloc(32, 0xab),
      submittedAt: new Date("2026-04-20T00:00:00Z"),
      circleSettleTxUuid: "svm-sig-prior",
      circleSettleResponseReceivedAt: new Date("2026-04-20T00:00:01Z"),
      circleSettleNetwork: "solana:mainnet",
      failureCode: null,
      failureMessage: null,
    };
    const prisma = svmPrismaStub({ intent, existingSubmission: existing });
    const svmSettle = {
      settle: jest.fn(),
    } as unknown as ICircleSettleSvmClient;
    const { svc } = buildSvmService({ prisma, svmSettle });

    const result = await svc.submitNanopaySvm({
      intentId: "pi_svm_01",
      signedTransaction: SIGNED_TX_BASE64,
    });

    expect(result.status).toBe("SETTLED");
    expect(result.attestation?.id).toBe("svm-sig-prior");
    expect((svmSettle as any).settle).not.toHaveBeenCalled();
    expect(prisma.nanopaySubmission.create).not.toHaveBeenCalled();
  });
});
