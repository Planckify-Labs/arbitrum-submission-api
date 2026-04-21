/**
 * Account-number at-rest encryption helpers.
 *
 * ⚠️ SECURITY REVIEW REQUIRED ⚠️
 *
 * The UMKM payout spec (§6.6) REQUIRES envelope encryption for
 * `merchants.xendit_account_number` and `xendit_payouts.account_number_encrypted`
 * columns, with the KMS / `pgcrypto` / app-level helper the repo already
 * uses elsewhere.
 *
 * As of task 29 this backend has NO existing envelope helper (grepped for
 * `encrypt` / `decrypt` / `KMS` / `envelope` across `api/src/`, nothing
 * matches). Rather than roll our own AES-GCM in this file and risk getting
 * the nonce discipline wrong, we ship a **base64 stopgap** so the column
 * shape (`Bytes`) is honoured and the wiring is provably correct — and
 * file a loud TODO for the security review before M3 production.
 *
 * WHAT'S IN PLACE TODAY:
 *   - `encryptAccountNumber("1234567890")` → utf-8 bytes base64-wrapped.
 *   - `decryptAccountNumber(bytes)` → reverses the base64 wrap.
 *
 * WHAT MUST CHANGE BEFORE PRODUCTION:
 *   1. Replace the base64 wrap with real envelope crypto. Recommended:
 *      AES-256-GCM with a per-row 96-bit nonce, DEK wrapped with a
 *      project-level KEK from AWS/GCP KMS (or HashiCorp Vault).
 *   2. Migrate existing rows via a one-shot script (trivial today because
 *      the DB is empty; will get more painful once merchants exist).
 *   3. Do NOT change the `Bytes` column shape — stay wire-compatible.
 *
 * Until then: **never deploy this adapter with a real XENDIT_SECRET_KEY.**
 *
 * Related task in the backlog: security_review_needed (file
 * `security_review_needed.md` in the repo root).
 *
 * Spec refs: umkm-usdc-payout-spec.md §6.6 "Sensitive fields", §9
 * "security", task file 29 §3 "Envelope encryption".
 */

/**
 * Wrap a plaintext account number for at-rest storage.
 *
 * TODO(security): replace with real envelope encryption (see file header).
 * DO NOT LOG the input — account numbers are PII and leak-sensitive.
 */
export function encryptAccountNumber(plaintext: string): Buffer {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptAccountNumber: plaintext must be a non-empty string");
  }
  // STOPGAP: base64 wrap so the `Bytes` column round-trips cleanly and
  // downstream adapters never see a raw string. Provides zero confidentiality.
  return Buffer.from(Buffer.from(plaintext, "utf8").toString("base64"), "utf8");
}

/**
 * Unwrap a stored account number back to plaintext for the Xendit call.
 *
 * TODO(security): replace with real envelope decryption (see file header).
 * DO NOT LOG the output — account numbers are PII and leak-sensitive.
 */
export function decryptAccountNumber(ciphertext: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
  if (buf.length === 0) {
    throw new Error("decryptAccountNumber: ciphertext must be non-empty");
  }
  // STOPGAP: reverse the base64 wrap. Throws via utf8 decoder on malformed
  // input — callers surface that as a 500 (not a 4xx) because it means the
  // DB row is corrupt, not the request.
  try {
    return Buffer.from(buf.toString("utf8"), "base64").toString("utf8");
  } catch (err) {
    throw new Error(
      `decryptAccountNumber: malformed ciphertext (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Redact an account number for logging. Keeps the last 4 for support-case
 * triangulation, masks the rest.
 */
export function redactAccountNumber(plaintext: string): string {
  if (plaintext.length <= 4) return "****";
  return `${"*".repeat(plaintext.length - 4)}${plaintext.slice(-4)}`;
}
