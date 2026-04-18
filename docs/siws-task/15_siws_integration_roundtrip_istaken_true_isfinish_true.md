# Task 15 — Integration: `@solana/kit` round-trip → `/auth/verify`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §6 bullets 3–4

## Why this matters

Unit tests (task 14) cover the builder and verifier in isolation. An
HTTP-level round-trip test catches integration seams: DTO validation,
controller dispatch, nonce set/get across the cache, dispatcher
routing, login upsert, JWT issuance. It also proves the symmetry
claim in spec §3.5 — that `signBytes` on mobile and `verifySignature`
on server, both backed by `@solana/kit`, interoperate.

**Depends on:** tasks 06, 07, 08, 09, 10 (full server path) — must
be merged before this test can pass.

## Scope

Add a Jest e2e / supertest file under `test/` (matching existing
structure):

SIWS round-trip:
1. Generate a server-side Solana keypair via `@solana/kit`
   `generateKeyPairSigner` (or equivalent low-level
   `generateKeyPair`).
2. `GET /auth/nonce/<base58>?chainSlug=solana-devnet` → receive
   `{ nonce, message }`.
3. Sign the message bytes with the keypair
   (`signBytes(privateKey, utf8(message))`).
4. Base58-encode the 64-byte signature.
5. `POST /auth/verify { message, signature }` → assert 200 with
   `AuthResponseDto`.
6. Decode the JWT → assert `addressNamespace === "solana"` (once task
   11 lands) and `walletAddress` is the base58 pubkey verbatim
   (mixed-case preserved).
7. Assert the nonce is gone from Valkey after verify.

SIWE regression (must remain green):
- Existing SIWE integration test is preserved, unmodified.

Negative paths:
- Replay: call verify twice with the same signature → second call
  returns 401.
- Expired: monkey-patch `Date.now` (or use a short TTL override) to
  expire the message, verify → 401.

## Rules (non-negotiable)

- **Use `@solana/kit` on both ends of the test.** Same library as
  production; test with a polyfill or `tweetnacl` would not prove
  the symmetry claim.
- **Boot a real Nest app in the test**, not a mock of
  `AuthService`. The dispatcher, DTO, and controller are part of
  what we're testing.
- **Valkey can be real or an in-memory mock compatible with the
  nonce service** — follow whatever existing SIWE integration tests
  use.
- **Test data uses `solana-devnet`** to make intent obvious; mainnet
  path is covered by the unit tests (task 14).

## Acceptance

- [ ] New e2e file covers the 7-step happy path.
- [ ] Replay test: second verify with same sig → 401.
- [ ] Expiry test: expired message → 401.
- [ ] SIWE e2e remains green in the same suite.
- [ ] `pnpm run test:e2e` runs the new file and all prior tests to
      completion on CI.

## Out of scope

- Mobile-side e2e (spec §6 bullet 5, tracked separately in the
  mobile repo).
- Wallet-Standard adapter compatibility matrix (spec §7 Q3).
