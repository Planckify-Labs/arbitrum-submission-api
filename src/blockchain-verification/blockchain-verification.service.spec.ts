import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import { BlockchainVerificationService } from "./blockchain-verification.service";
import { SolanaVerificationService } from "./solana-verification.service";
import { StellarVerificationService } from "./stellar-verification.service";
import type { TTransactionVerificationResult } from "./types/blockchain-verification.types";

const SOLANA_BLOCKCHAIN_ID = "blockchain_solana_devnet";
const STELLAR_BLOCKCHAIN_ID = "blockchain_stellar_testnet";
const EVM_BLOCKCHAIN_ID = "blockchain_polygon";
const SUI_BLOCKCHAIN_ID = "blockchain_sui_testnet";
const EVM_CHAIN_ID = 137;
const CUSTOM_PROGRAM_ID = "CuStomProgram1111111111111111111111111111111";
const CUSTOM_CONTRACT_ID = "CCLFTLVPHOKKDZYTMGU6UNXKFEN6VF3QVYEAJNULGIC7ZXTETAIPKKRZ";

const baseRequest = {
  transactionHash: "5WbxpNm8...",
  expectedSender: "SenderAddr",
  expectedRecipient: "RecipientAddr",
  expectedChainId: 0,
  refId: "ref_001",
  contractAddress: "ContractAddr",
  expectedBookingId: "booking_001",
  expectedExchangeRateId: "42",
  expectedProductVariantId: "variant_001",
  expectedAmount: "1000000",
};

const solanaResult: TTransactionVerificationResult = {
  isValid: true,
  transactionHash: "5WbxpNm8...",
  blockNumber: "123456",
  confirmations: 1,
  from: "SenderAddr",
  to: "ProgramId",
  value: "1000000",
  status: "success",
  gasUsed: "5000",
  blockTimestamp: "1700000000",
  chainId: 0,
};

const stellarResult: TTransactionVerificationResult = {
  isValid: true,
  transactionHash: "d36b93cda1...",
  blockNumber: "3562633",
  confirmations: 1,
  from: "SenderAddr",
  to: CUSTOM_CONTRACT_ID,
  value: "1000000",
  status: "success",
  gasUsed: "0",
  blockTimestamp: "1783829403",
  chainId: 0,
};

function makePrismaStub() {
  const blockchainRows: Record<string, unknown> = {
    [SOLANA_BLOCKCHAIN_ID]: {
      id: SOLANA_BLOCKCHAIN_ID,
      name: "Solana Devnet",
      isActive: true,
      chainSlug: "solana-devnet",
      type: "SVM",
    },
    [STELLAR_BLOCKCHAIN_ID]: {
      id: STELLAR_BLOCKCHAIN_ID,
      name: "Stellar Testnet",
      isActive: true,
      chainSlug: "stellar-testnet",
      type: "STELLAR",
    },
    [EVM_BLOCKCHAIN_ID]: {
      id: EVM_BLOCKCHAIN_ID,
      name: "Polygon",
      isActive: true,
      chainId: EVM_CHAIN_ID,
      chainSlug: null,
      type: "EVM",
    },
    [SUI_BLOCKCHAIN_ID]: {
      id: SUI_BLOCKCHAIN_ID,
      name: "Sui Testnet",
      isActive: true,
      chainSlug: "sui-testnet",
      type: "MOVE_VM",
    },
  };

  // `takumi_pay`'s address now lives in SmartContract (name: "takumi_pay"),
  // not a scalar column on the blockchain row — see
  // BlockchainVerificationService.requireTakumiPayContractAddress.
  const smartContractRows: Record<string, { address: string } | undefined> = {
    [SOLANA_BLOCKCHAIN_ID]: { address: CUSTOM_PROGRAM_ID },
    [STELLAR_BLOCKCHAIN_ID]: { address: CUSTOM_CONTRACT_ID },
  };

  return {
    blockchain: {
      findUnique: jest.fn(({ where }) => Promise.resolve(blockchainRows[where.id] ?? null)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    smartContract: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(smartContractRows[where.blockchainId] ?? null),
      ),
    },
  };
}

function makeSolanaStub() {
  return {
    verifyTransaction: jest.fn(async () => solanaResult),
    verifyTransactionRecord: jest.fn(),
    verifyMerchantPayment: jest.fn(),
    verifyPointDeposit: jest.fn(),
  } as unknown as jest.Mocked<SolanaVerificationService>;
}

function makeStellarStub() {
  return {
    verifyTransaction: jest.fn(async () => stellarResult),
    verifyTransactionRecord: jest.fn(),
    verifyMerchantPayment: jest.fn(),
    verifyPointDeposit: jest.fn(),
  } as unknown as jest.Mocked<StellarVerificationService>;
}

function makeConfigStub() {
  return {
    get: jest.fn((key: string, defaultVal?: unknown) => {
      if (key === "MIN_CONFIRMATIONS") return 12;
      return defaultVal;
    }),
  };
}

function buildService() {
  const prisma = makePrismaStub();
  const solana = makeSolanaStub();
  const stellar = makeStellarStub();
  const config = makeConfigStub();

  const svc = new BlockchainVerificationService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    solana as unknown as SolanaVerificationService,
    stellar as unknown as StellarVerificationService,
  );

  return { svc, prisma, solana, stellar };
}

describe("BlockchainVerificationService.verifyTransaction routing", () => {
  it("dispatches to SolanaVerificationService when blockchain is non-EVM", async () => {
    const { svc, solana, prisma } = buildService();

    const result = await svc.verifyTransaction({
      ...baseRequest,
      blockchainId: SOLANA_BLOCKCHAIN_ID,
    });

    expect(result).toBe(solanaResult);
    expect(solana.verifyTransaction).toHaveBeenCalledTimes(1);
    expect(solana.verifyTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        blockchainId: SOLANA_BLOCKCHAIN_ID,
        transactionSignature: baseRequest.transactionHash,
        refId: baseRequest.refId,
        expectedWalletAddress: baseRequest.expectedSender,
        expectedTokenMint: baseRequest.expectedRecipient,
        expectedAmount: baseRequest.expectedAmount,
        expectedBookingId: baseRequest.expectedBookingId,
        expectedExchangeRateId: baseRequest.expectedExchangeRateId,
        expectedProductVariantId: baseRequest.expectedProductVariantId,
      }),
    );
    expect(prisma.blockchain.findUnique).toHaveBeenCalledWith({
      where: { id: SOLANA_BLOCKCHAIN_ID },
    });
  });

  it("does NOT dispatch to Solana when blockchain is EVM", async () => {
    const { svc, solana } = buildService();

    await expect(
      svc.verifyTransaction({
        ...baseRequest,
        expectedChainId: EVM_CHAIN_ID,
        blockchainId: EVM_BLOCKCHAIN_ID,
      }),
    ).rejects.toThrow(/Unsupported chain ID/);

    expect(solana.verifyTransaction).not.toHaveBeenCalled();
  });

  it("resolves the program id from the takumi_pay SmartContract row", async () => {
    const { svc, solana, prisma } = buildService();

    await svc.verifyTransaction({
      ...baseRequest,
      blockchainId: SOLANA_BLOCKCHAIN_ID,
    });

    const call = solana.verifyTransaction.mock.calls[0][0];
    expect(call.programId.toBase58()).toBe(CUSTOM_PROGRAM_ID);
    expect(prisma.smartContract.findFirst).toHaveBeenCalledWith({
      where: { blockchainId: SOLANA_BLOCKCHAIN_ID, name: "takumi_pay", isActive: true },
    });
  });

  it("throws when non-EVM blockchain has no active takumi_pay SmartContract row", async () => {
    const { svc, solana, prisma } = buildService();

    (prisma.smartContract.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      svc.verifyTransaction({
        ...baseRequest,
        blockchainId: SOLANA_BLOCKCHAIN_ID,
      }),
    ).rejects.toThrow(/has no active "takumi_pay" SmartContract row configured/);

    expect(solana.verifyTransaction).not.toHaveBeenCalled();
  });

  it("dispatches to StellarVerificationService when blockchain is Stellar", async () => {
    const { svc, stellar } = buildService();

    const result = await svc.verifyTransaction({
      ...baseRequest,
      blockchainId: STELLAR_BLOCKCHAIN_ID,
    });

    expect(result).toBe(stellarResult);
    expect(stellar.verifyTransaction).toHaveBeenCalledTimes(1);
    expect(stellar.verifyTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        blockchainId: STELLAR_BLOCKCHAIN_ID,
        transactionHash: baseRequest.transactionHash,
        refId: baseRequest.refId,
        expectedWalletAddress: baseRequest.expectedSender,
        expectedTokenAddress: baseRequest.expectedRecipient,
        expectedAmount: baseRequest.expectedAmount,
        expectedBookingId: baseRequest.expectedBookingId,
        expectedExchangeRateId: baseRequest.expectedExchangeRateId,
        expectedProductVariantId: baseRequest.expectedProductVariantId,
      }),
    );
  });

  it("throws a clear error for a recognized-but-unhandled chain family (Sui/MOVE_VM) instead of misrouting to Solana", async () => {
    const { svc, solana, stellar } = buildService();

    await expect(
      svc.verifyTransaction({
        ...baseRequest,
        blockchainId: SUI_BLOCKCHAIN_ID,
      }),
    ).rejects.toThrow(/Unsupported chain family/);

    expect(solana.verifyTransaction).not.toHaveBeenCalled();
    expect(stellar.verifyTransaction).not.toHaveBeenCalled();
  });

  it("throws a clear error for a genuinely unrecognized chain family value", async () => {
    const { svc, prisma } = buildService();

    (prisma.blockchain.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "blockchain_mystery",
      name: "Mystery Chain",
      isActive: true,
      chainSlug: "mystery-testnet",
      type: "GARBAGE",
    });

    await expect(
      svc.verifyTransaction({
        ...baseRequest,
        blockchainId: "blockchain_mystery",
      }),
    ).rejects.toThrow(/Unrecognized chain family "GARBAGE"/);
  });
});
