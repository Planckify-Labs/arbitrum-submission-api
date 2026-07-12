/**
 * TS mirrors of the Rust structs in
 * ../../../../../contract/stellar/contracts/takumi_pay/src/types.rs.
 * Addresses are plain StrKey strings (G... accounts / C... contracts) —
 * Stellar has no PublicKey-wrapper-class equivalent worth introducing here.
 * u64/i128 fields are `bigint`, matching what `@stellar/stellar-sdk`'s
 * `scValToNative` returns for those XDR types.
 */

export interface StellarTransactionRecord {
  txId: bigint;
  walletAddress: string;
  token: string;
  bookingId: string;
  exchangeRateId: bigint;
  productVariantId: string;
  refId: string;
  amount: bigint;
  timestamp: bigint;
}

export interface StellarMerchantPayment {
  payer: string;
  token: string;
  merchantId: string;
  refId: string;
  amount: bigint;
  platformFeeAmount: bigint;
  fiatAmountMinor: bigint;
  fiatCurrency: Buffer;
  exchangeRateId: bigint;
  timestamp: bigint;
}

export interface StellarPointDepositRecord {
  depositId: bigint;
  walletAddress: string;
  token: string;
  amount: bigint;
  refId: string;
  timestamp: bigint;
}

/**
 * Input to `signMerchantQuote` — mirrors the Rust `MerchantQuote` struct
 * field-for-field. `token` must be the SAC contract id (C...), not the
 * classic `"{CODE}:{ISSUER}"` compound string stored on the `Token` row.
 */
export interface MerchantQuoteParams {
  refId: string;
  merchantId: string;
  token: string;
  amount: bigint;
  platformFeeAmount: bigint;
  fiatAmountMinor: bigint;
  fiatCurrency: Buffer;
  exchangeRateId: bigint;
  expiresAt: bigint;
}
