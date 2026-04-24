/**
 * Duitku disbursement API signature helpers.
 *
 * Auth for Duitku's legacy disbursement product is payload-level: every
 * request carries a `signature` field computed as SHA256 of an ordered
 * concatenation of specific fields + the shared `secretKey`. One byte in
 * the wrong slot and the server rejects with `-191 Wrong signature` with
 * no further diagnostic. Collapsing every formula into a single typed
 * builder means the ordering is impossible to get wrong at the call site
 * and gives us one place to unit-test (task 12 pins this against the
 * Duitku PHP SDK's reference vectors).
 *
 * Spec refs:
 *   - duitku_payout_provider_research.md §2.4 (signature formulas)
 *   - task file 05 (this module's creation brief)
 *   - Duitku PHP SDK canonical reference: github.com/duitkupg/duitku-php
 *
 * Keep this module dependency-free — no Nest, no ConfigService, no logger.
 * Credentials flow in as arguments; callers are responsible for redacting
 * `secretKey` at log boundaries (port rule 2).
 */

import { createHash } from "node:crypto";

/**
 * Duitku credentials tuple. Pulled from `ConfigService` in the adapter
 * (task 06) and passed into `buildSignature` verbatim. `userId` and
 * `apiBase` don't appear in any signature formula but travel alongside
 * for convenience — the adapter's request body needs them too.
 */
export interface DuitkuCredentials {
  userId: number | string;
  email: string;
  secretKey: string;
  apiBase: string;
}

/**
 * Discriminated union over the five endpoint signature shapes documented
 * in research §2.4. Field order below MUST match the formula column
 * verbatim — reordering a key here silently breaks signatures because the
 * builder joins by declaration order.
 */
export type DuitkuEndpoint =
  | {
      kind: "inquiry";
      email: string;
      timestamp: number;
      bankCode: string;
      bankAccount: string;
      amountTransfer: number | string;
      purpose: string;
      secretKey: string;
    }
  | {
      kind: "transfer";
      email: string;
      timestamp: number;
      bankCode: string;
      bankAccount: string;
      accountName: string;
      custRefNumber: string;
      amountTransfer: number | string;
      purpose: string;
      disburseId: string;
      secretKey: string;
    }
  | {
      kind: "inquiryStatus";
      email: string;
      timestamp: number;
      disburseId: string;
      secretKey: string;
    }
  | {
      // Shared formula for checkBalance + listBank per research §2.4.
      kind: "checkBalance" | "listBank";
      email: string;
      timestamp: number;
      secretKey: string;
    }
  | {
      // Future H2H / Cash-Out callback — verifier, not a request builder.
      // See research §2.8; v1 RTOL has no callback so this is unused.
      kind: "clearingCallback";
      email: string;
      bankCode: string;
      bankAccount: string;
      accountName: string;
      custRefNumber: string;
      amountTransfer: number | string;
      disburseId: string;
      secretKey: string;
    };

/**
 * Raw SHA256 helper — concatenates parts (as strings) UTF-8 and returns
 * lowercase hex. Exposed separately so the signature vector test can
 * assert the trivial primitive independently of the endpoint glue.
 *
 * Hex is ALWAYS lowercase — Duitku's verifier is case-sensitive and
 * rejects upper-case with `-191`.
 */
export function duitkuSha256(...parts: Array<string | number>): string {
  const joined = parts.map((p) => String(p)).join("");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

/**
 * Build the `signature` field for a Duitku request. Call site supplies
 * a shape-discriminated object; this helper picks the fields in the
 * exact order research §2.4 mandates. A typo or reordered call site
 * fails `pnpm run build` (the discriminant guards each branch).
 */
export function buildSignature(endpoint: DuitkuEndpoint): string {
  switch (endpoint.kind) {
    case "inquiry":
      return duitkuSha256(
        endpoint.email,
        endpoint.timestamp,
        endpoint.bankCode,
        endpoint.bankAccount,
        endpoint.amountTransfer,
        endpoint.purpose,
        endpoint.secretKey,
      );
    case "transfer":
      return duitkuSha256(
        endpoint.email,
        endpoint.timestamp,
        endpoint.bankCode,
        endpoint.bankAccount,
        endpoint.accountName,
        endpoint.custRefNumber,
        endpoint.amountTransfer,
        endpoint.purpose,
        endpoint.disburseId,
        endpoint.secretKey,
      );
    case "inquiryStatus":
      return duitkuSha256(
        endpoint.email,
        endpoint.timestamp,
        endpoint.disburseId,
        endpoint.secretKey,
      );
    case "checkBalance":
    case "listBank":
      return duitkuSha256(
        endpoint.email,
        endpoint.timestamp,
        endpoint.secretKey,
      );
    case "clearingCallback":
      return duitkuSha256(
        endpoint.email,
        endpoint.bankCode,
        endpoint.bankAccount,
        endpoint.accountName,
        endpoint.custRefNumber,
        endpoint.amountTransfer,
        endpoint.disburseId,
        endpoint.secretKey,
      );
  }
}

/**
 * Unix milliseconds as a JS number. Duitku's server rejects requests with
 * > 5-minute skew (`-960 Timestamp expired`), so the caller must build
 * fresh at request time, not reuse a stale value.
 */
export function buildTimestamp(): number {
  return Date.now();
}

/**
 * Verify a Duitku clearing/cash-out callback signature. Unused by v1
 * (RTOL has no callback — `DuitkuPayoutProvider.verifyWebhookSignature`
 * returns `false`), but the helper is written so the eventual H2H/cash-out
 * work can drop it into the webhook controller without reinventing the
 * byte layout.
 *
 * Returns `true` only when the computed SHA256 matches the supplied
 * signature (lowercase-hex comparison).
 */
export function verifyCallbackSignature(
  payload: {
    email: string;
    bankCode: string;
    bankAccount: string;
    accountName: string;
    custRefNumber: string;
    amountTransfer: number | string;
    disburseId: string;
    signature: string;
  },
  secretKey: string,
): boolean {
  const computed = buildSignature({
    kind: "clearingCallback",
    email: payload.email,
    bankCode: payload.bankCode,
    bankAccount: payload.bankAccount,
    accountName: payload.accountName,
    custRefNumber: payload.custRefNumber,
    amountTransfer: payload.amountTransfer,
    disburseId: payload.disburseId,
    secretKey,
  });
  // Duitku sends lowercase hex; we normalise defensively before compare.
  return computed === payload.signature.toLowerCase();
}
