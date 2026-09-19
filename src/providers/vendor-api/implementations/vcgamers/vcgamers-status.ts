import {
  TVCgamerResponse,
  TVCGamerOrderResponse,
  TVCGamersOrderStatusData,
} from "../../types/vcgamer-api.types";
import type {
  VendorOrderFailure,
  VendorOrderOutcome,
} from "../../base/base-vendor.service";

/**
 * VCGamers-specific: how their order-status body maps onto the
 * provider-agnostic fulfilment port. Nothing outside this adapter reads
 * `data.status` or `history_status`.
 */

export interface VendorStatusClassification {
  outcome: VendorOrderOutcome;
  /** `detail.voucher_code` verbatim, or null. */
  raw: string | null;
  /** Human-readable reason for `failed`, from the vendor's status history. */
  reason?: string;
}

export interface VendorStatusCodes {
  /** `data.status` values that mean delivered. */
  success: number[];
  /** `data.status` values that mean terminal failure. */
  failed: number[];
}

/**
 * 2 = final/success is established by the existing integration. The
 * failure code is not in VCGamers' public docs — confirm with their
 * integration team and adjust here; until then the status-history name
 * match in `classifyVendorStatus` is the safety net.
 */
export const VCGAMERS_STATUS_CODES: VendorStatusCodes = {
  success: [2],
  failed: [3],
};

// Indonesian + English status names VCGamers has been seen to use.
const FAILED_STATUS_NAME =
  /\b(fail|failed|gagal|cancel|cancelled|batal|dibatalkan|refund|refunded|reject|rejected|ditolak|error)\b/i;
const SUCCESS_STATUS_NAME =
  /\b(success|sukses|berhasil|completed|delivered)\b/i;

/**
 * Map a VCGamers order-status body to one of three outcomes. Anything not
 * clearly terminal is `pending` — the poller keeps asking. The numeric
 * code decides first; the newest `history_status` entry is the fallback
 * for codes we have not been told about.
 */
export function classifyVendorStatus(
  data: TVCGamersOrderStatusData,
  codes: VendorStatusCodes = VCGAMERS_STATUS_CODES,
): VendorStatusClassification {
  const raw = data.detail?.voucher_code?.trim() || null;
  const latest = [...(data.history_status ?? [])].sort((a, b) =>
    String(b.timestamp).localeCompare(String(a.timestamp)),
  )[0];
  const latestName = latest?.status_name ?? "";

  if (codes.success.includes(Number(data.status))) {
    return { outcome: "delivered", raw };
  }
  if (codes.failed.includes(Number(data.status))) {
    return {
      outcome: "failed",
      raw,
      reason: latestName || `status ${data.status}`,
    };
  }
  if (FAILED_STATUS_NAME.test(latestName)) {
    return { outcome: "failed", raw, reason: latestName };
  }
  // A success-looking name with an unknown code: trust it only when the
  // vendor also handed something over — a code alone is not a delivery.
  if (SUCCESS_STATUS_NAME.test(latestName) && raw) {
    return { outcome: "delivered", raw };
  }
  return { outcome: "pending", raw };
}

// Business-level rejections: the vendor understood the request and said
// no (bad player id, sold out, price mismatch). Safe to refund.
const DEFINITIVE_HTTP = new Set([400, 402, 404, 409, 410, 422]);

/**
 * When `createOrder` does not yield an accepted order, decide whether the
 * money can go back automatically. Only a rejection the vendor clearly
 * made is `definitive`. Timeouts, 5xx, rate limits, our own auth problems
 * and lost responses are `ambiguous`: the order may exist on the vendor
 * side, and refunding it would hand the buyer both the product and the
 * money. Those go to ops.
 */
export function classifyOrderFailure(
  resp: TVCgamerResponse<TVCGamerOrderResponse>,
): VendorOrderFailure {
  if (resp.success && resp.data) {
    const txStatus = resp.data.data?.transaction_status ?? "";
    const status = resp.data.status ?? "";
    if (
      /fail|gagal|reject|ditolak/i.test(txStatus) ||
      /fail|gagal/i.test(status)
    ) {
      return {
        cls: "definitive",
        reason: `vendor rejected order: ${txStatus || status}`,
      };
    }
    return {
      cls: "ambiguous",
      reason: "order response without a terminal status",
    };
  }

  const httpStatus = resp.originalError?.status;
  const message = resp.originalError?.message || resp.message || "vendor error";
  if (httpStatus !== undefined && DEFINITIVE_HTTP.has(httpStatus)) {
    return { cls: "definitive", reason: `${httpStatus}: ${message}` };
  }
  return {
    cls: "ambiguous",
    reason: httpStatus ? `${httpStatus}: ${message}` : `transport: ${message}`,
  };
}
