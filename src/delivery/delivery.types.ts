import { DeliveryType } from "@generated/prisma";

/**
 * Which tier produced the structured view. Anything but `exact` means the
 * client must also show `raw` — the parse is a convenience, the raw string
 * is the product the user paid for.
 */
export type DeliveryParseTier = "exact" | "template" | "heuristic" | "none";

export interface DeliveryField {
  label: string;
  value: string;
  /** Show a copy button. Defaults to false; the `primary` is always copyable. */
  copyable?: boolean;
}

/**
 * The one shape mobile renders, regardless of vendor or product. Built
 * server-side so a new voucher format is a deploy (or a DB template), not
 * an app-store release.
 */
export interface DeliveryPayload {
  kind: "voucher" | "topup" | "bill" | "email";
  /** The thing to redeem — big, copyable. Absent for top-ups. */
  primary?: DeliveryField;
  fields: DeliveryField[];
  /** Vendor's `voucher_code` verbatim. Null when the vendor sent none. */
  raw: string | null;
  parse: DeliveryParseTier;
  parserId: string | null;
  /**
   * Where a top-up / bill / email went — the number, account or address
   * the buyer typed at checkout. Lets the card say "sent to 0812…".
   */
  target?: string;
}

/**
 * Ops-editable positional parser stored on `Product.voucherTemplate`.
 * `fields` are the labels in vendor order; an empty label drops that
 * segment. `primary` is the index of the redeemable code.
 */
export interface VoucherTemplate {
  separator: string;
  fields: string[];
  primary: number;
}

export interface ParseInput {
  productCode: string;
  deliveryType: DeliveryType;
  raw: string | null;
  template?: VoucherTemplate | null;
  /** `BookingOrder.customerInfo` / `PointRedemption.customerInfo`. */
  customerInfo?: unknown;
}

export function isVoucherTemplate(value: unknown): value is VoucherTemplate {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.separator === "string" &&
    t.separator.length > 0 &&
    Array.isArray(t.fields) &&
    t.fields.every((f) => typeof f === "string") &&
    typeof t.primary === "number" &&
    Number.isInteger(t.primary) &&
    t.primary >= 0 &&
    t.primary < (t.fields as string[]).length
  );
}

/**
 * `deliveryType` is nullable on Product so the column could be added
 * without a data migration; the legacy `isVoucher` flag decides until ops
 * sets it explicitly.
 */
export function resolveDeliveryType(product: {
  deliveryType: DeliveryType | null;
  isVoucher: boolean;
}): DeliveryType {
  if (product.deliveryType) return product.deliveryType;
  return product.isVoucher
    ? DeliveryType.VOUCHER_CODE
    : DeliveryType.DIRECT_TOPUP;
}
