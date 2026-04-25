import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export interface TakumiPayTransactionRecord {
  config: PublicKey;
  txId: BN;
  walletAddress: PublicKey;
  tokenMint: PublicKey;
  bookingId: string;
  exchangeRateId: BN;
  productVariantId: string;
  refId: string;
  amount: BN;
  timestamp: BN;
  bump: number;
}

export interface TakumiPayMerchantPayment {
  config: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  merchantId: string;
  refId: string;
  amount: BN;
  platformFeeAmount: BN;
  fiatAmountMinor: BN;
  fiatCurrency: number[];
  exchangeRateId: BN;
  timestamp: BN;
  bump: number;
}

export interface TakumiPayPointDepositRecord {
  config: PublicKey;
  depositId: BN;
  walletAddress: PublicKey;
  tokenMint: PublicKey;
  amount: BN;
  refId: string;
  timestamp: BN;
  bump: number;
}

export interface MerchantQuoteParams {
  refId: string;
  refIdHash: number[];
  merchantId: string;
  amount: BN;
  platformFeeAmount: BN;
  fiatAmountMinor: BN;
  fiatCurrency: number[];
  exchangeRateId: BN;
  expiresAt: BN;
}
