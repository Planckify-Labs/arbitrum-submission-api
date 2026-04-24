import type { Merchant, PaymentIntent } from "@generated/prisma";

export type PayerInput =
  | { kind: "signature"; signature: string }
  | { kind: "txHash"; txHash: string; chainId: number };

export interface SettleArgs {
  intent: PaymentIntent;
  merchant: Merchant;
  payerInput: PayerInput;
}

export interface SettleReceipt {
  settlementId: string;
  status: "SETTLED" | "SETTLING";
  txHash?: string;
}

export class SettlementRejectedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SettlementRejectedError";
  }
}

export class SettlementInFlightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementInFlightError";
  }
}
