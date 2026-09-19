import { DeliveryPayload } from "../delivery.types";

export const PLN_PARSER_ID = "pln@2";

// PLN voucher format (slash-delimited, order may vary):
//   2174-8986-6628-2450-0152/NURMULIANI-MTMN/R1/450VA/43.9KWH
// vcGamer data is inconsistent: unit suffixes are sometimes dropped, the
// kWh decimal separator can be "." or ",", casing/spacing on "VA"/"KWH"
// varies, and the comma decimal shows up whether or not the suffix is
// present, e.g.:
//   0591-0184-8779-9496-4877/NURMULIANIMTMN/R1/450/109,6
//   2174-8986-6628-2450-0152/NURMULIANI-MTMN/r1/450 VA/109,6KWH
//
// Each segment is identified by its pattern, not its position:
//   Token code  — five groups of 4 digits joined by dashes
//   kWh         — digits (dot or comma decimal) optionally followed by KWH
//   VA / power  — digits optionally followed by VA
//   Tarif       — R + digits (e.g. R1, R2)
//   Name        — anything else
//
// Ported verbatim from mobile `utils/vcGamerUtils.ts` so the server owns
// the parser and a format drift is a deploy, not an app-store release.
const PLN_TOKEN_CODE = /^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/;
const PLN_KWH = /^([\d.,]+)\s*KWH$/i;
const PLN_VA = /^(\d+)\s*VA$/i;
const PLN_TARIF = /^R\d+$/i;
const PLN_BARE_INTEGER = /^\d+$/;
const PLN_BARE_DECIMAL = /^\d+[.,]\d+$/;

export function isPlnVoucher(raw: string): boolean {
  return raw.split("/").some((part) => PLN_TOKEN_CODE.test(part.trim()));
}

export function parsePln(raw: string): DeliveryPayload | null {
  if (!isPlnVoucher(raw)) return null;

  const parts = raw.split("/").map((part) => part.trim());

  let tokenCode = "";
  let name = "";
  let tarif = "";
  let power = "";
  let kwh = "";

  for (const part of parts) {
    if (PLN_TOKEN_CODE.test(part)) {
      tokenCode = part;
    } else if (PLN_KWH.test(part)) {
      const match = part.match(PLN_KWH);
      kwh = match ? match[1].replace(",", ".") : part;
    } else if (PLN_VA.test(part)) {
      const match = part.match(PLN_VA);
      power = match ? `${match[1]} VA` : part.toUpperCase();
    } else if (PLN_TARIF.test(part)) {
      tarif = part.toUpperCase();
    } else if (!kwh && PLN_BARE_DECIMAL.test(part)) {
      kwh = part.replace(",", ".");
    } else if (!power && PLN_BARE_INTEGER.test(part)) {
      power = `${part} VA`;
    } else if (part) {
      name = part;
    }
  }

  const fields: DeliveryPayload["fields"] = [];
  if (name) fields.push({ label: "Name", value: name });
  if (tarif || power) {
    fields.push({
      label: "Tarif / Power",
      value: tarif && power ? `${tarif} / ${power}` : tarif || power,
    });
  }
  if (kwh) fields.push({ label: "kWh", value: `${kwh} kWh` });

  return {
    kind: "voucher",
    primary: { label: "Token", value: tokenCode, copyable: true },
    fields,
    raw,
    parse: "exact",
    parserId: PLN_PARSER_ID,
  };
}
