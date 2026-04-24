# Task 05 — `duitkuSha256` + endpoint-typed signature builders

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.4 (signature formulas), §4.1, §4.5

## Why this matters

Duitku auth is entirely payload-level — every request carries a
`signature` field computed as SHA256 of an ordered concatenation of
specific fields + the shared secret. One byte of wrong ordering or
one missing field and the server returns `-191 Wrong signature` with
no further diagnostic. Collapsing every formula into a single typed
helper makes the ordering impossible to get wrong at the call site
and gives us one place to unit-test (task 12).

## Scope

Create `src/payout/duitku-signature.ts`:

- Export `duitkuSha256(...parts: Array<string | number>): string` —
  hex-lowercase SHA256 of `parts.join("")` (UTF-8). Trivial, one-liner,
  but centralizes the hash dependency.
- Export a discriminated `DuitkuEndpoint` type covering the five
  signature shapes from research §2.4:
  - `inquiry`: email + timestamp + bankCode + bankAccount +
    amountTransfer + purpose + secretKey
  - `transfer`: email + timestamp + bankCode + bankAccount +
    accountName + custRefNumber + amountTransfer + purpose +
    disburseId + secretKey
  - `inquiryStatus`: email + timestamp + disburseId + secretKey
  - `checkBalance` / `listBank`: email + timestamp + secretKey
  - `clearingCallback` (future H2H): email + bankCode + bankAccount +
    accountName + custRefNumber + amountTransfer + disburseId +
    secretKey
- Export `buildSignature(endpoint: DuitkuEndpoint, credentials:
  DuitkuCredentials): string` — takes the per-endpoint field bag plus
  `{ email, secretKey }` and returns the hex string, enforcing order
  via the type.
- Export `buildTimestamp(): number` — Unix milliseconds as a double
  per research §2.4 (Duitku rejects skew > 5 min).

Optional: export `verifyCallbackSignature(payload, secretKey): boolean`
for future H2H/cash-out work — stub is fine for v1 (we don't receive
RTOL callbacks). Include it only if zero-cost.

## Rules (non-negotiable)

- **No Nest DI.** This is a pure module — no `@Injectable`, no
  `ConfigService`, no logger. Credentials are passed in; the helper
  does not read env.
- **Field order is encoded in the type, not documented in a comment.**
  If you can call `buildSignature` with fields in the wrong order and
  still compile, the abstraction has failed — redo it.
- **Never log `secretKey` or the final signature.** The signature is
  not sensitive on its own, but log-level discipline matters for
  training the redaction tests in task 13.
- **Hex must be lowercase.** Duitku's verifier is
  case-sensitive — upper-case hex fails with `-191`.
- `timestamp` is **Unix milliseconds** (number), not seconds, not ISO.
  If you're unsure, read §2.4 again.

## Acceptance

- [ ] `src/payout/duitku-signature.ts` exists with `duitkuSha256`,
      `buildSignature`, `buildTimestamp`, `DuitkuEndpoint`,
      `DuitkuCredentials` exports.
- [ ] Each of the five endpoint discriminants enforces field presence
      and order at the type level — intentionally passing a wrong
      shape fails `pnpm run build`.
- [ ] Pure: no imports from `@nestjs/*` or `src/config`.
- [ ] `pnpm run test` green (smoke-level; real vectors land in task 12).

## Out of scope

- Signature vector tests vs the Duitku PHP SDK — task 12.
- HTTP transport and adapter wiring — task 06+.
- Callback verifier implementation (beyond an optional stub) — future
  H2H work per research §2.8.
