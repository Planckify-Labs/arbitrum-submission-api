# Security Review: Required Before M3 Production

This file tracks security-sensitive items that must be resolved before the
TakumiPay API goes live against real merchants and real Xendit keys.

## 1. Envelope encryption for Xendit account numbers

**Status:** STOPGAP IN PLACE — NOT PRODUCTION-READY.

**Where:** `src/payout/account-number-crypto.ts`

The payout pipeline (task 29) stores merchant bank / e-wallet account
numbers in two places:

- `merchants.xenditAccountNumber` (`Bytes`, per §6.6)
- `xendit_payouts.accountNumberEncrypted` (`Bytes`, per §6.6)

Spec §6.6 mandates these be encrypted at rest via KMS / `pgcrypto` / an
application-level envelope helper. As of task 29 the backend has no
existing envelope encryption helper (confirmed via grep for
`encrypt` / `decrypt` / `KMS` / `envelope` across `api/src/`).

The current implementation is a **base64 wrap** — it round-trips the column
shape correctly but provides zero confidentiality. This is documented
prominently in the source with a `TODO(security)` comment.

### What must change before production

1. Implement AES-256-GCM envelope encryption with:
   - Per-row 96-bit nonce.
   - Data-encryption key (DEK) wrapped with a project-level KEK from
     AWS KMS / GCP KMS / HashiCorp Vault.
2. Migrate any existing rows via a one-shot script.
3. Keep the `Bytes` column shape — do not alter the schema.
4. Audit every caller of `decryptAccountNumber` to confirm plaintext
   never leaves the request scope (no logging, no caching, no side-channel
   exfiltration).

### Deploy gate

**Do NOT deploy `XenditPayoutProvider` with a real `XENDIT_SECRET_KEY`
(`xnd_production_…`) until this item is closed.** The sandbox key is fine
for M3 staging work because Xendit's test mode never moves real IDR.

## 2. Mobile never receives Xendit env values

Tracked in `feedback_role_separation.md` (user memory). Backend env vars
with the `XENDIT_` prefix MUST NOT be prefixed with `EXPO_PUBLIC_` and
MUST NOT be mirrored into `takumi-agent-api` or `takumipay-mobile-app`.
Current state: compliant — grep confirms no `EXPO_PUBLIC_XENDIT_*` anywhere
in the monorepo.

## 3. Account number redaction in logs

Enforced at the sink: `redactAccountNumber` masks everything except the
last 4 characters. The `XenditPayoutProvider` logs the redacted form only.
**Any future caller that needs to log account numbers must go through
`redactAccountNumber` — never format the plaintext directly.**

## 4. Migrate third-party credentials to a secrets manager

**Status:** OPEN — acceptable for v1 / small chain count.

**Where:** every third-party credential the API currently holds:

- `XENDIT_SECRET_KEY` (in `.env`)
- `CIRCLE_API_KEY` (in `.env`)
- `TAKUMIPAY_QR_PRIVATE_KEY_PEM` (in `.env`)
- `Blockchain.bundlerUrl` (in DB, per chainId — carries the provider API key
  in the query string as an interim shape)
- `CIRCLE_X402_SVM_FACILITATOR_URL` (in `.env`, if it gains an auth token later)

`.env` and DB are both reasonable on-ramps at small scale but don't carry us when:

- Ops / product need to rotate keys without a deploy cycle.
- Horizontal scaling means every rotation triggers rolling restarts.
- Compliance wants audit logs on who-read-which-secret-when.
- DB backups start containing third-party credentials (current
  `Blockchain.bundlerUrl` situation — DB dumps go to less-tightly-ACL'd
  storage than a secrets manager would).

### What to migrate to

Any of — pick based on infra you already run:

- **AWS Secrets Manager** if the API already runs on AWS.
- **HashiCorp Vault** if self-hosted is preferred.
- **Doppler** for a low-ops SaaS option.

### What the migration looks like

1. **Split URL from key.** `Blockchain.bundlerUrl` becomes the clean
   endpoint path (`https://api.pimlico.io/v2/base/rpc`), a new
   `Blockchain.bundlerProvider` column names the provider
   (`"pimlico" | "alchemy" | "stackup"`), and the API key moves out.
2. **Resolve the key at request time** via a new `BundlerCredentialsService`
   that reads from the secrets manager and caches with a short TTL. Swap
   the bundler client call to send the key as `Authorization: Bearer <key>`
   — all three major providers support header auth, so the key never has
   to sit in the URL.
3. **Migrate credentials in priority order:**
   - Bundler keys first (most-rotated, highest blast radius if leaked).
   - `XENDIT_SECRET_KEY` / `CIRCLE_API_KEY` next (rotation cadence driven
     by provider policy).
   - `TAKUMIPAY_QR_PRIVATE_KEY_PEM` last (rotation already covered by
     `docs/jwk_rotation_runbook.md`, low urgency).
4. Keep `.env` / DB working as fallbacks during the transition — missing
   secret in the manager falls through to the existing source so rollout
   is non-breaking.

### Why not migrate to DB instead?

Considered and rejected as the *sole* target. Bundler URLs embed API keys
in the query string, so putting the URL-with-key verbatim on
`Blockchain.bundlerUrl` would mean:

- Keys end up in nightly DB backups (usually with broader read-access
  than a secrets manager).
- Risk of accidental serialization into the public `/v1/blockchains`
  endpoint (task 21).
- No rotation audit trail.

**But the URL and the key split naturally** — the terminal state uses
both: DB for the URL-without-key + provider identifier, secrets manager
for the API key itself, HTTP client reassembles at request time via
`Authorization: Bearer` header (all three major providers — Pimlico,
Alchemy, Stackup — support header auth, so the key never has to sit in
the URL at all).

Concrete shape:

```ts
// Schema
model Blockchain {
  // ...
  bundlerUrl      String?   // https://api.pimlico.io/v2/base/rpc
  bundlerProvider String?   // "pimlico" | "alchemy" | "stackup"
}

// Runtime
const chain = await prisma.blockchain.findUnique({ where: { chainId } });
const apiKey = await bundlerCredentials.getFor(chain.bundlerProvider);
await fetch(chain.bundlerUrl, {
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(userOp),
});
```

This also shrinks the credential set from N (one key per chain) to M
(one key per provider) — rotation is O(providers), not O(chains).

DB is the right home for public chain config (RPC URLs, contract addresses,
bundler URLs without keys); the secrets manager is the right home for the
keys themselves.

### Deploy gate

None. The current `.env` approach is acceptable for staging and early
production with a single-digit chain count. Re-evaluate when chain count
exceeds ~10 or when an admin-panel rotation workflow is requested.
