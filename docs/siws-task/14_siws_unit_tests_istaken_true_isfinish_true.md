# Task 14 — SIWS unit tests: builder byte-identity + verifier edges

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §6 bullets 1–2

## Why this matters

A SIWS verifier that diverges from the mobile builder by one byte of
whitespace silently rejects every real signature. Unit tests that
cover (a) byte-identity between server and mobile builders and (b)
the verifier's edge-case matrix are the only defense against this
class of bug after the refactor lands.

**Depends on:** task 05 (builder), task 06 (verifier).

## Scope

Create `src/auth/siws/siws-message.spec.ts`:

- Import fixtures that are **byte-identical** to what
  `mobile-app/services/chains/solana/siws.ts` would produce for the
  same payload. Options (pick whichever is lower-friction):
  - Add a small shared fixtures JSON checked into both repos.
  - Copy the mobile `buildSiwsMessage` output for ~3 fixed payloads
    (mainnet, devnet, with/without `resources`) verbatim into the
    test file.
- Assert `buildSiwsMessage(payload) === fixture` for every fixture.
  Any whitespace, ordering, or label drift fails the test.

Create `src/auth/siws/siws.service.spec.ts` covering verifier edges:

- Valid signature → `success: true`, nonce deleted from cache.
- Wrong nonce in cache → `success: false`, nonce not deleted.
- `expirationTime` in the past → reject (checked before signature).
- `domain` mismatch vs `SIWE_DOMAIN` → reject.
- Malformed base58 address → reject.
- 63-byte signature (wrong length) → reject.
- Missing `Expiration Time:` line in message → reject (parser).
- CRLF in message → reject (parser).
- Pubkey off the ed25519 curve's torsion subgroup → **accept**
  (matches Phantom reference per spec §4).

## Rules (non-negotiable)

- **Generate keypairs via `@solana/kit`** (same library used in
  production) in tests. Do not hand-roll ed25519 test vectors from a
  different lib — that defeats the point of the single-library
  choice (spec §3.5).
- **No mocks of `SiwsService.verify` internals.** Test the public
  method end-to-end with a real signature. Mock `NonceCacheService`
  only (to set/assert cache state).
- **Fixture payloads use fixed `issuedAt` / `expirationTime` /
  `nonce`** so the test is deterministic. Do not rely on `Date.now`
  at test time for the byte-identity assertions.
- **Run against the same Node version as production** (≥20), since
  Web Crypto Ed25519 is a platform dependency.

## Acceptance

- [ ] `siws-message.spec.ts` asserts byte-identity for ≥3 fixtures.
- [ ] `siws.service.spec.ts` covers all 9 cases above.
- [ ] `pnpm test -- --testPathPattern=siws` is green.
- [ ] Coverage report shows `siws-message.ts` and `siws.service.ts`
      each > 90% line coverage.

## Out of scope

- HTTP-level round-trip (task 15).
- Mobile-side signing tests (those live in the mobile repo).
