import { DeliveryPayload, VoucherTemplate } from "../delivery.types";

/**
 * Positional parser driven by `Product.voucherTemplate`. Deliberately
 * dumb: split on the separator, label by position. If the vendor sends a
 * different number of segments than the template expects the template is
 * wrong for this order — return null so the next tier runs and the shape
 * log shows ops a template that no longer matches.
 */
export function parseWithTemplate(
  raw: string,
  template: VoucherTemplate,
  productCode: string,
): DeliveryPayload | null {
  const parts = raw.split(template.separator).map((p) => p.trim());
  if (parts.length !== template.fields.length) return null;

  const primaryValue = parts[template.primary];
  if (!primaryValue) return null;

  const fields: DeliveryPayload["fields"] = [];
  template.fields.forEach((label, i) => {
    if (i === template.primary || !label || !parts[i]) return;
    fields.push({ label, value: parts[i] });
  });

  return {
    kind: "voucher",
    primary: {
      label: template.fields[template.primary] || "Code",
      value: primaryValue,
      copyable: true,
    },
    fields,
    raw,
    parse: "template",
    parserId: `template:${productCode}`,
  };
}
