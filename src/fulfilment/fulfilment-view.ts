import {
  DeliveryType,
  FulfilmentRefundStatus,
  FulfilmentStatus,
} from "@generated/prisma";
import {
  DeliveryPayload,
  resolveDeliveryType,
} from "../delivery/delivery.types";

/**
 * The fulfilment block every order read path returns. Built from the
 * columns alone (no vendor call) so list endpoints can include it too.
 */
export interface FulfilmentView {
  status: FulfilmentStatus;
  deliveryType: DeliveryType;
  expectedBy: string | null;
  fulfilledAt: string | null;
  lastCheckedAt: string | null;
  /** Present on FAILED / NEEDS_RECONCILE; never the raw vendor body. */
  error: string | null;
  delivery: DeliveryPayload | null;
  refund: { status: FulfilmentRefundStatus; points: string } | null;
}

export function fulfilmentView(row: {
  fulfilmentStatus: FulfilmentStatus;
  fulfilmentError: string | null;
  delivery: unknown;
  expectedBy: Date | null;
  fulfilledAt: Date | null;
  vendorLastCheckedAt: Date | null;
  productVariant: {
    product: { deliveryType: DeliveryType | null; isVoucher: boolean };
  };
  refund?: { status: FulfilmentRefundStatus; points: bigint } | null;
}): FulfilmentView {
  return {
    status: row.fulfilmentStatus,
    deliveryType: resolveDeliveryType(row.productVariant.product),
    expectedBy: row.expectedBy?.toISOString() ?? null,
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
    lastCheckedAt: row.vendorLastCheckedAt?.toISOString() ?? null,
    error:
      row.fulfilmentStatus === FulfilmentStatus.FAILED ||
      row.fulfilmentStatus === FulfilmentStatus.NEEDS_RECONCILE
        ? userSafeError(row.fulfilmentError)
        : null,
    delivery: (row.delivery as DeliveryPayload | null) ?? null,
    refund: row.refund
      ? { status: row.refund.status, points: row.refund.points.toString() }
      : null,
  };
}

/**
 * The stored error is for ops ("vendor rejected: 422: invalid user id").
 * The buyer gets the part after the last label, never HTTP codes or
 * vendor names.
 */
function userSafeError(stored: string | null): string | null {
  if (!stored) return null;
  const tail = stored.split(":").pop()?.trim() ?? "";
  if (!tail || /vendor|vcgamer|http|transport|timeout/i.test(tail)) {
    return "The provider could not complete this order.";
  }
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** Legacy `voucherCode` for app versions that predate `delivery`. */
export function legacyVoucherCode(
  delivery: DeliveryPayload | null,
  deliveryRaw: string | null,
): string | null {
  return deliveryRaw ?? delivery?.raw ?? delivery?.primary?.value ?? null;
}

/**
 * Past this age a QUEUED order holding a vendor ref never went through the
 * state machine: the worker moves it to SUBMITTED within seconds.
 */
export const LEGACY_QUEUED_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The vendor accepted it, yet it sits at the column default: it predates
 * the fulfilment leg, or its migration's backfill never ran (`prisma db
 * push` applies columns but skips a migration's data SQL).
 */
export function isLegacyQueued(
  row: {
    fulfilmentStatus: FulfilmentStatus;
    vendorRefId: string | null;
    createdAt: Date;
  },
  now = Date.now(),
): boolean {
  return (
    row.fulfilmentStatus === FulfilmentStatus.QUEUED &&
    !!row.vendorRefId &&
    now - row.createdAt.getTime() > LEGACY_QUEUED_AFTER_MS
  );
}

/** A read path should ask the vendor when the user is looking and nobody has recently. */
export function isWorthChecking(
  row: {
    fulfilmentStatus: FulfilmentStatus;
    vendorRefId: string | null;
    vendorLastCheckedAt: Date | null;
  },
  minIntervalMs = 10_000,
): boolean {
  if (!row.vendorRefId) return false;
  if (
    row.fulfilmentStatus !== FulfilmentStatus.QUEUED &&
    row.fulfilmentStatus !== FulfilmentStatus.SUBMITTED &&
    row.fulfilmentStatus !== FulfilmentStatus.DELAYED &&
    row.fulfilmentStatus !== FulfilmentStatus.NEEDS_RECONCILE
  ) {
    return false;
  }
  const last = row.vendorLastCheckedAt?.getTime() ?? 0;
  return Date.now() - last > minIntervalMs;
}
