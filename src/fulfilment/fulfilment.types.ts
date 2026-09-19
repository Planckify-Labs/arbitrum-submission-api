import { DeliveryType, FulfilmentStatus } from "@generated/prisma";
import { VoucherTemplate } from "../delivery/delivery.types";

export type FulfilmentKind = "purchase" | "redemption";

export const FULFILMENT_QUEUE = "fulfilment-check";

export interface FulfilmentCheckJob {
  kind: FulfilmentKind;
  id: string;
  /** Index into the backoff schedule; 0 for the first check. */
  attempt: number;
}

/**
 * One shape for both `Purchase` and `PointRedemption` so the state machine
 * is written once. Built by `FulfilmentService.load`.
 */
export interface FulfilmentTarget {
  kind: FulfilmentKind;
  id: string;
  fulfilmentStatus: FulfilmentStatus;
  vendorRefId: string | null;
  createdAt: Date;
  expectedBy: Date | null;
  vendorCheckCount: number;
  /** Redemptions have a user; purchases are keyed by wallet (+ user via the tx). */
  userId: string | null;
  walletAddress: string | null;
  productCode: string;
  productName: string;
  deliveryType: DeliveryType;
  voucherTemplate: VoucherTemplate | null;
  slaSeconds: number | null;
  customerInfo: unknown;
}

/** Terminal for the poller: nothing more to ask the vendor. */
export const TERMINAL_FULFILMENT: ReadonlySet<FulfilmentStatus> = new Set([
  FulfilmentStatus.DELIVERED,
  FulfilmentStatus.FAILED,
]);

/** States a fresh vendor answer is allowed to move forward from. */
export const OPEN_FULFILMENT: FulfilmentStatus[] = [
  FulfilmentStatus.QUEUED,
  FulfilmentStatus.SUBMITTED,
  FulfilmentStatus.DELAYED,
  FulfilmentStatus.NEEDS_RECONCILE,
];
