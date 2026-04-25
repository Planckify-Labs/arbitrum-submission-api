import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Connection, PublicKey, Commitment, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PrismaService } from "../prisma/prisma.service";
import { TAKUMI_PAY_IDL } from "./solana/takumi-pay/idl";
import {
  deriveConfigPda,
  deriveTxRecordPda,
  deriveRefRecordPda,
  deriveMerchantPaymentPda,
  derivePointDepositPda,
  derivePointRefRecordPda,
  TAKUMI_PAY_PROGRAM_ID,
} from "./solana/takumi-pay/pda";
import { computeRefIdHash } from "./solana/takumi-pay/ref-id-hash";
import type {
  TakumiPayTransactionRecord,
  TakumiPayMerchantPayment,
  TakumiPayPointDepositRecord,
  MerchantQuoteParams,
} from "./solana/takumi-pay/types";
import * as nacl from "tweetnacl";

@Injectable()
export class SolanaVerificationService implements OnModuleInit {
  private readonly logger = new Logger(SolanaVerificationService.name);
  private connection: Connection;
  private program: any;
  private signerKeypair: Keypair | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const rpcUrl = this.config.get<string>("SOLANA_RPC_URL");
    if (!rpcUrl) {
      this.logger.warn(
        "SOLANA_RPC_URL not configured — Solana verification disabled",
      );
      return;
    }
    this.connection = new Connection(rpcUrl, "confirmed");

    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
    } as any;
    const provider = new AnchorProvider(this.connection, dummyWallet, {
      commitment: "confirmed",
    });
    const programId = new PublicKey(
      this.config.get<string>("TAKUMI_PAY_PROGRAM_ID") ??
        TAKUMI_PAY_PROGRAM_ID.toBase58(),
    );
    this.program = new Program(TAKUMI_PAY_IDL as any, provider as any);

    const signerKey = this.config.get<string>(
      "SOLANA_QUOTE_SIGNER_PRIVATE_KEY",
    );
    if (signerKey) {
      try {
        const decoded = JSON.parse(signerKey);
        this.signerKeypair = Keypair.fromSecretKey(new Uint8Array(decoded));
      } catch {
        this.logger.warn("Failed to parse SOLANA_QUOTE_SIGNER_PRIVATE_KEY");
      }
    }
  }

  async waitForConfirmation(
    signature: string,
    commitment: Commitment = "finalized",
  ): Promise<void> {
    const bh = await this.connection.getLatestBlockhash(commitment);
    await this.connection.confirmTransaction(
      {
        signature,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      },
      commitment,
    );
  }

  async verifyTransactionRecord(args: {
    programId: PublicKey;
    refId: string;
    refIdHash: Uint8Array;
    expectedWalletAddress: string;
    expectedTokenMint: string;
    expectedAmount: string;
    expectedBookingId: string;
    expectedExchangeRateId: string;
    expectedProductVariantId: string;
  }): Promise<TakumiPayTransactionRecord> {
    const [configPda] = deriveConfigPda(args.programId);
    const [refRecordPda] = deriveRefRecordPda(
      args.programId,
      configPda,
      args.refIdHash,
    );

    const refRecord = await this.program.account.refRecord.fetch(refRecordPda);
    const txId = refRecord.recordId;
    const [txRecordPda] = deriveTxRecordPda(args.programId, configPda, txId);
    const txRecord =
      await this.program.account.transactionRecord.fetch(txRecordPda);

    if (txRecord.walletAddress.toBase58() !== args.expectedWalletAddress) {
      throw new Error(
        `Wallet address mismatch: expected ${args.expectedWalletAddress}, got ${txRecord.walletAddress.toBase58()}`,
      );
    }
    if (txRecord.tokenMint.toBase58() !== args.expectedTokenMint) {
      throw new Error("Token mint mismatch");
    }
    if (txRecord.amount.toString() !== args.expectedAmount) {
      throw new Error("Amount mismatch");
    }
    if (txRecord.bookingId !== args.expectedBookingId) {
      throw new Error("Booking ID mismatch");
    }
    if (txRecord.exchangeRateId.toString() !== args.expectedExchangeRateId) {
      throw new Error("Exchange rate ID mismatch");
    }
    if (txRecord.productVariantId !== args.expectedProductVariantId) {
      throw new Error("Product variant ID mismatch");
    }

    return txRecord;
  }

  async verifyMerchantPayment(args: {
    programId: PublicKey;
    refId: string;
    refIdHash: Uint8Array;
    expectedPayer: string;
    expectedMerchantId: string;
    expectedTokenMint: string;
    expectedAmount: string;
    expectedFiatAmountMinor: number;
    expectedFiatCurrency: string;
    expectedExchangeRateId: number;
  }): Promise<TakumiPayMerchantPayment> {
    const [configPda] = deriveConfigPda(args.programId);
    const [merchantPaymentPda] = deriveMerchantPaymentPda(
      args.programId,
      configPda,
      args.refIdHash,
    );
    const mp =
      await this.program.account.merchantPayment.fetch(merchantPaymentPda);

    if (mp.payer.toBase58() !== args.expectedPayer)
      throw new Error("Payer mismatch");
    if (mp.merchantId !== args.expectedMerchantId)
      throw new Error("Merchant ID mismatch");
    if (mp.tokenMint.toBase58() !== args.expectedTokenMint)
      throw new Error("Token mint mismatch");
    if (mp.amount.toString() !== args.expectedAmount)
      throw new Error("Amount mismatch");
    if (mp.fiatAmountMinor.toNumber() !== args.expectedFiatAmountMinor)
      throw new Error("Fiat amount mismatch");
    if (mp.exchangeRateId.toNumber() !== args.expectedExchangeRateId)
      throw new Error("Exchange rate ID mismatch");

    return mp;
  }

  async verifyPointDeposit(args: {
    programId: PublicKey;
    refId: string;
    refIdHash: Uint8Array;
    expectedWalletAddress: string;
    expectedTokenMint: string;
    expectedAmount: bigint;
  }): Promise<TakumiPayPointDepositRecord> {
    const [configPda] = deriveConfigPda(args.programId);
    const [pointRefPda] = derivePointRefRecordPda(
      args.programId,
      configPda,
      args.refIdHash,
    );
    const refRecord =
      await this.program.account.refRecord.fetch(pointRefPda);
    const depositId = refRecord.recordId;
    const [depositPda] = derivePointDepositPda(
      args.programId,
      configPda,
      depositId,
    );
    const deposit =
      await this.program.account.pointDepositRecord.fetch(depositPda);

    if (deposit.walletAddress.toBase58() !== args.expectedWalletAddress)
      throw new Error("Wallet address mismatch");
    if (deposit.tokenMint.toBase58() !== args.expectedTokenMint)
      throw new Error("Token mint mismatch");
    if (BigInt(deposit.amount.toString()) !== args.expectedAmount)
      throw new Error("Amount mismatch");

    return deposit;
  }

  signMerchantQuote(params: MerchantQuoteParams): Uint8Array {
    if (!this.signerKeypair)
      throw new Error("Solana quote signer not configured");

    const message = this.buildQuoteMessage(params);
    return nacl.sign.detached(message, this.signerKeypair.secretKey);
  }

  private buildQuoteMessage(params: MerchantQuoteParams): Uint8Array {
    const parts: Uint8Array[] = [];

    const refIdBytes = new TextEncoder().encode(params.refId);
    const refIdLen = new Uint8Array(4);
    new DataView(refIdLen.buffer).setUint32(0, refIdBytes.length, true);
    parts.push(refIdLen, refIdBytes);

    const merchantIdBytes = new TextEncoder().encode(params.merchantId);
    const merchantIdLen = new Uint8Array(4);
    new DataView(merchantIdLen.buffer).setUint32(
      0,
      merchantIdBytes.length,
      true,
    );
    parts.push(merchantIdLen, merchantIdBytes);

    // token_mint placeholder (32 bytes of zeros for SOL, or actual mint bytes)
    parts.push(new Uint8Array(32));

    const u64le = (bn: BN) => {
      const buf = bn.toArrayLike(Buffer, "le", 8);
      return new Uint8Array(buf);
    };
    parts.push(u64le(params.amount));
    parts.push(u64le(params.platformFeeAmount));
    parts.push(u64le(params.fiatAmountMinor));
    parts.push(new Uint8Array(params.fiatCurrency));
    parts.push(u64le(params.exchangeRateId));

    const expiresAtBuf = params.expiresAt.toArrayLike(Buffer, "le", 8);
    parts.push(new Uint8Array(expiresAtBuf));

    const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
    const msg = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) {
      msg.set(p, offset);
      offset += p.length;
    }
    return msg;
  }
}
