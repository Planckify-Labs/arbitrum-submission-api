export interface TTransactionLog {
  address: string;
  blockHash: string;
  blockNumber: string;
  blockTimestamp?: string;
  data: string;
  logIndex: number;
  removed: boolean;
  topics: string[];
  transactionHash: string;
  transactionIndex: number;
}

export interface TTransaction {
  blockHash: string;
  blockNumber: string;
  chainId: number;
  from: string;
  gas: string;
  gasPrice: string;
  hash: string;
  input: string;
  nonce: number;
  r: string;
  s: string;
  to: string | null;
  transactionIndex: number;
  type: string;
  v: string;
  value: string;
  typeHex: string;
}

export interface TTransactionReceipt {
  blockHash: string;
  blockNumber: string;
  contractAddress: string | null;
  cumulativeGasUsed: string;
  effectiveGasPrice: string;
  from: string;
  gasUsed: string;
  logs: TTransactionLog[];
  logsBloom: string;
  status: "success" | "reverted";
  to: string | null;
  transactionHash: string;
  transactionIndex: number;
  type: string;
}

export interface TValidatedTransactionData {
  transaction: TTransaction;
  receipt: TTransactionReceipt;
  confirmations: number;
  blockTimestamp: string;
  isValid: boolean;
  validationErrors?: string[];
}

export interface TTransactionValidationParams {
  transactionHash: string;
  expectedSender: string;
  expectedRecipient: string;
  expectedChainId: number;
  expectedAmount?: string;
  tokenAddress?: string;
  minimumConfirmations?: number;
}

export interface TERC20TransferEvent {
  from: string;
  to: string;
  amount: string;
  tokenAddress: string;
  logIndex: number;
  transactionHash: string;
}

export interface TNativeTokenTransfer {
  from: string;
  to: string;
  amount: string;
  transactionHash: string;
}

export interface TParsedTransactionAmounts {
  nativeAmount: string;
  erc20Transfers: TERC20TransferEvent[];
}
