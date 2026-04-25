import { BlockchainVerificationService } from "./blockchain-verification.service";
import { SolanaVerificationService } from "./solana-verification.service";
import type { TTransactionVerificationResult } from "./types/blockchain-verification.types";

const SOLANA_BLOCKCHAIN_ID = "blockchain_solana_devnet";
const EVM_BLOCKCHAIN_ID = "blockchain_polygon";
const EVM_CHAIN_ID = 137;
const CUSTOM_PROGRAM_ID = "CuStomProgram1111111111111111111111111111111";

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

function makePrismaStub() {
  const rows: Record<string, any> = {
    [SOLANA_BLOCKCHAIN_ID]: {
      id: SOLANA_BLOCKCHAIN_ID,
      name: "Solana Devnet",
      isEVM: false,
      isActive: true,
      chainSlug: "solana-devnet",
      takumiPayProgramId: CUSTOM_PROGRAM_ID,
    },
    [EVM_BLOCKCHAIN_ID]: {
      id: EVM_BLOCKCHAIN_ID,
      name: "Polygon",
      isEVM: true,
      isActive: true,
      chainId: EVM_CHAIN_ID,
      chainSlug: null,
      takumiPayProgramId: null,
    },
  };
  return {
    blockchain: {
      findUnique: jest.fn(({ where }) => Promise.resolve(rows[where.id] ?? null)),
      findMany: jest.fn(() => Promise.resolve([])),
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

function makeConfigStub() {
  return {
    get: jest.fn((key: string, defaultVal?: any) => {
      if (key === "MIN_CONFIRMATIONS") return 12;
      return defaultVal;
    }),
  };
}

function buildService() {
  const prisma = makePrismaStub();
  const solana = makeSolanaStub();
  const config = makeConfigStub();

  const svc = new BlockchainVerificationService(
    prisma as any,
    config as any,
    solana as any,
  );

  return { svc, prisma, solana };
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

  it("passes takumiPayProgramId from the blockchain row", async () => {
    const { svc, solana } = buildService();

    await svc.verifyTransaction({
      ...baseRequest,
      blockchainId: SOLANA_BLOCKCHAIN_ID,
    });

    const call = solana.verifyTransaction.mock.calls[0][0];
    expect(call.programId.toBase58()).toBe(CUSTOM_PROGRAM_ID);
  });

  it("throws when non-EVM blockchain has no takumiPayProgramId", async () => {
    const { svc, solana, prisma } = buildService();

    (prisma.blockchain.findUnique as jest.Mock).mockResolvedValueOnce({
      id: SOLANA_BLOCKCHAIN_ID,
      name: "Solana Devnet",
      isEVM: false,
      isActive: true,
      takumiPayProgramId: null,
    });

    await expect(
      svc.verifyTransaction({
        ...baseRequest,
        blockchainId: SOLANA_BLOCKCHAIN_ID,
      }),
    ).rejects.toThrow(/has no takumiPayProgramId configured/);

    expect(solana.verifyTransaction).not.toHaveBeenCalled();
  });
});
