export interface TTakumiWalletTransaction {
  walletAddress: string;
  tokenAddress: string;
  bookingId: string;
  exchangeRateId: bigint;
  productVariantId: string;
  timestamp: bigint;
  refId: string;
  amount: bigint;
}

export interface TTransactionVerificationResult {
  isValid: boolean;
  transactionHash: string;
  blockNumber: string;
  confirmations: number;
  from: string;
  to: string;
  value: string;
  status: "success" | "reverted";
  gasUsed: string;
  blockTimestamp: string;
  chainId: number;
}

export interface TTransactionVerificationRequest {
  transactionHash: string;
  expectedSender: string;
  expectedRecipient: string;
  expectedChainId: number;
  minimumConfirmations?: number;
  refId: string;
  contractAddress: string;
  expectedBookingId: string;
  expectedExchangeRateId: string;
  expectedProductVariantId: string;
  expectedAmount: string;
}
