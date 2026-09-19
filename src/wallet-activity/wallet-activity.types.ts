import type { ZerionCallbackPayload } from "./zerion-callback.types";

export const WALLET_ACTIVITY_QUEUE = "wallet-activity";

export type WalletActivityJobData =
  /** One Zerion callback, verbatim. */
  | { kind: "callback"; payload: ZerionCallbackPayload }
  /** Make sure these wallets are in the Zerion subscription. */
  | { kind: "subscribe"; wallets: string[] }
  /** Full reconcile: our wallet set + chain list vs. Zerion's. */
  | { kind: "reconcile" };
