/**
 * Machine-readable failure codes for the onchain settlement rail (task 31, spec §8).
 *
 * `OnchainFailureCode` is the internal domain enum; `translateFailureCode`
 * maps it to the wire-format string visible to mobile callers.
 */
export type OnchainFailureCode =
  | "TX_REVERTED"
  | "SENDER_MISMATCH"
  | "RECIPIENT_MISMATCH"
  | "REF_NOT_ON_CHAIN"
  | "CONTRACT_DATA_MISMATCH"
  | "TIMEOUT"
  | "INSUFFICIENT_CONFIRMATIONS"
  | "INTENT_ALREADY_SETTLED"
  | "PAYER_INPUT_WRONG_KIND"
  | "UNKNOWN";

const FAILURE_TO_WIRE: Record<OnchainFailureCode, string> = {
  TX_REVERTED: "TRANSACTION_FAILED",
  SENDER_MISMATCH: "VERIFICATION_FAILED",
  RECIPIENT_MISMATCH: "VERIFICATION_FAILED",
  REF_NOT_ON_CHAIN: "VERIFICATION_FAILED",
  CONTRACT_DATA_MISMATCH: "VERIFICATION_FAILED",
  TIMEOUT: "TIMEOUT",
  INSUFFICIENT_CONFIRMATIONS: "PENDING",
  INTENT_ALREADY_SETTLED: "ALREADY_SETTLED",
  PAYER_INPUT_WRONG_KIND: "INVALID_INPUT",
  UNKNOWN: "INTERNAL_ERROR",
};

export function translateFailureCode(code: OnchainFailureCode): string {
  return FAILURE_TO_WIRE[code] ?? "INTERNAL_ERROR";
}
