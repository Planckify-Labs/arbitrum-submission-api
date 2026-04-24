import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../prisma/prisma.service";
import { BlockchainVerificationService } from "../../../blockchain-verification/blockchain-verification.service";
import type { IPaymentSettlementProvider } from "../settlement-provider.port";
import type { SettleArgs, SettleReceipt } from "../settlement.types";
import { SettlementRejectedError } from "../settlement.types";

@Injectable()
export class OnchainSettlementProvider implements IPaymentSettlementProvider {
  readonly key = "onchain" as const;
  private readonly logger = new Logger(OnchainSettlementProvider.name);

  constructor(
    private readonly blockchainVerification: BlockchainVerificationService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async settle({ intent, payerInput }: SettleArgs): Promise<SettleReceipt> {
    if (payerInput.kind !== "txHash") {
      throw new SettlementRejectedError("PAYER_INPUT_WRONG_KIND", "Onchain rail requires txHash");
    }
    const { txHash, chainId } = payerInput;

    // Idempotency
    const existing = await this.prisma.onchainSettlement.findFirst({
      where: { intentId: intent.id, txHash },
    });
    if (existing) {
      return { settlementId: existing.id, status: "SETTLED", txHash: existing.txHash };
    }

    // Check intent not already settled
    if (intent.status === "SETTLED" || intent.status === "PAID_OUT") {
      throw new SettlementRejectedError("INTENT_ALREADY_SETTLED", "Intent already settled");
    }

    const chainRow = await this.prisma.blockchain.findFirstOrThrow({
      where: { chainId, isActive: true, isEVM: true },
    });

    if (!chainRow.takumiWalletContract) {
      throw new SettlementRejectedError("NO_CONTRACT", "Chain has no TakumiWallet contract configured");
    }

    const payer = await this.prisma.user.findUniqueOrThrow({
      where: { id: intent.payerUserId! },
    });

    if (!payer.walletAddress) {
      throw new SettlementRejectedError("PAYER_NO_WALLET", "Payer has no wallet address");
    }

    try {
      // Phase A — tx-level checks
      await this.blockchainVerification.verifyTxReceiptOnly({
        transactionHash: txHash,
        expectedSender: payer.walletAddress,
        expectedRecipient: chainRow.takumiWalletContract,
        expectedChainId: chainId,
        minimumConfirmations: this.minConfirmations(chainRow),
      });

      // Phase B — merchant-payment contract verification
      // Resolve the token address for the intent
      const sourceToken = intent.sourceTokenId
        ? await this.prisma.token.findUnique({ where: { id: intent.sourceTokenId } })
        : null;
      const expectedTokenAddress = sourceToken?.contractAddress ?? "0x0000000000000000000000000000000000000000";

      await this.blockchainVerification.verifyMerchantPaymentInContract({
        contractAddress: chainRow.takumiWalletContract,
        chainId,
        refId: intent.id,
        expectedPayer: payer.walletAddress,
        expectedMerchantId: intent.merchantId,
        expectedTokenAddress,
        expectedAmount: (intent as any).tokenAmountMinor?.toString() ?? "0",
        expectedFiatAmountMinor: intent.fiatAmountMinor,
        expectedFiatCurrency: intent.fiatCurrency,
        expectedExchangeRateId: intent.exchangeRateId,
      });
    } catch (error) {
      // Timeout = in-flight
      if (error?.message?.includes("timeout") || error?.message?.includes("Timeout")) {
        const row = await this.prisma.onchainSettlement.create({
          data: {
            intentId: intent.id,
            txHash,
            chainId,
            failureCode: "TIMEOUT",
            failureMessage: error.message,
          },
        });
        return { settlementId: row.id, status: "SETTLING", txHash };
      }

      // Terminal failure
      const failureCode = this.extractFailureCode(error);
      await this.prisma.onchainSettlement.create({
        data: {
          intentId: intent.id,
          txHash,
          chainId,
          failureCode,
          failureMessage: error.message,
        },
      });
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: "FAILED" },
      });
      throw new SettlementRejectedError(failureCode, error.message);
    }

    // Success — persist and flip status
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.onchainSettlement.create({
        data: { intentId: intent.id, txHash, chainId, verifiedAt: new Date() },
      });
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: "SETTLED" },
      });
      return created;
    });

    return { settlementId: row.id, status: "SETTLED", txHash };
  }

  private minConfirmations(chain: { minConfirmations?: number | null }): number {
    return chain.minConfirmations
      ?? this.configService.get<number>("ONCHAIN_MIN_CONFIRMATIONS")
      ?? this.configService.get<number>("MIN_CONFIRMATIONS", 12);
  }

  private extractFailureCode(error: any): string {
    const msg = error?.message ?? "";
    if (msg.includes("reverted")) return "TX_REVERTED";
    if (msg.includes("Sender address mismatch")) return "SENDER_MISMATCH";
    if (msg.includes("Recipient address mismatch")) return "RECIPIENT_MISMATCH";
    if (msg.includes("refId mismatch") || msg.includes("REF_NOT_ON_CHAIN")) return "REF_NOT_ON_CHAIN";
    if (msg.includes("mismatch")) return "CONTRACT_DATA_MISMATCH";
    return "UNKNOWN";
  }
}
