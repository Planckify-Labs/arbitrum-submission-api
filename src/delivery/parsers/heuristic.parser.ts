import { DeliveryPayload } from "../delivery.types";

export const HEURISTIC_PARSER_ID = "heuristic@1";

const SEPARATORS = /\s*(?:\r?\n|\||;|\/)\s*/;
const KEY_VALUE = /^([A-Za-z][A-Za-z0-9 _-]{0,30})\s*[:=]\s*(.+)$/;
// A redeemable code: letters/digits with optional dash/space groups,
// 8+ chars, and not a plain sentence (no lowercase words in a row).
const CODE_LIKE = /^[A-Z0-9][A-Z0-9\- ]{6,}[A-Z0-9]$/;

// A label that says what the value is beats guessing from the value.
const CODE_LABEL = /\b(code|kode|token|voucher|pin|key|serial number)\b/i;
const NOT_CODE_LABEL =
  /\b(serial|sn|ref|reference|trx|order|invoice|no|nomor)\b/i;

function codeScore(value: string, label = ""): number {
  const v = value.trim();
  if (!CODE_LIKE.test(v.toUpperCase())) return 0;
  if (/[a-z]{3,}/.test(v)) return 0; // looks like a word, not a code
  // Prefer digit-heavy, longer, dash-grouped strings.
  const digits = (v.match(/\d/g) ?? []).length;
  const groups = (v.match(/-/g) ?? []).length;
  let score = v.length + digits + groups * 2;
  if (CODE_LABEL.test(label)) score += 20;
  else if (NOT_CODE_LABEL.test(label)) score -= 5;
  return score;
}

/**
 * Best-effort structure for a shape nobody has written a parser for yet:
 * split on the usual separators, keep `key: value` pairs as labelled
 * fields, promote the most code-looking segment to `primary`, and leave
 * the rest unlabelled. Always tagged `heuristic` so the client shows the
 * raw block alongside — this tier may pick the wrong segment.
 */
export function parseHeuristic(raw: string): DeliveryPayload {
  const segments = raw
    .split(SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);

  const fields: DeliveryPayload["fields"] = [];
  let primary: DeliveryPayload["primary"];
  let bestScore = 0;

  for (const segment of segments) {
    const kv = segment.match(KEY_VALUE);
    if (kv) {
      const [, label, value] = kv;
      const score = codeScore(value, label);
      if (score > bestScore) {
        if (primary) fields.push({ ...primary, copyable: true });
        primary = { label: label.trim(), value: value.trim(), copyable: true };
        bestScore = score;
      } else {
        fields.push({ label: label.trim(), value: value.trim() });
      }
      continue;
    }

    const score = codeScore(segment);
    if (score > bestScore) {
      if (primary) fields.push({ ...primary, copyable: true });
      primary = { label: "Code", value: segment, copyable: true };
      bestScore = score;
    } else {
      fields.push({ label: "", value: segment });
    }
  }

  return {
    kind: "voucher",
    primary,
    fields,
    raw,
    parse: "heuristic",
    parserId: HEURISTIC_PARSER_ID,
  };
}
