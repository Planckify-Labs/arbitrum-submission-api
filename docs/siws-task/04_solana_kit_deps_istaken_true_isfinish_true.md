# Task 04 — Install `@solana/keys` + `@solana/addresses`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §3.5, §5 step 3

## Why this matters

`SiwsService` (task 06) verifies ed25519 signatures using the same
library the mobile app signs with (`@solana/kit`). Keeping the same
crypto path on both sides eliminates a class of "signs on mobile,
verifies wrong on server" bugs. This task adds only the deps needed;
no code consumes them yet.

## Scope

- `pnpm add @solana/keys @solana/addresses` in `takumipay-api`.
- Confirm Node runtime target is ≥ 20 (Web Crypto Ed25519 is built-in).
  Check `package.json#engines` and any Dockerfile / deploy image.
- Do **not** install `@solana/webcrypto-ed25519-polyfill`. Node 20+
  doesn't need it.
- Do **not** install `@noble/curves` or any alternative ed25519 lib —
  single crypto path is the whole point.

## Rules (non-negotiable)

- **Match the mobile version** of `@solana/kit` where practical. The
  mobile app is the source-of-truth for signer behavior; verifier deps
  must not drift major versions away. Check
  `mobile-app/package.json` for the current `@solana/kit` version and
  pin compatible ranges for `@solana/keys` and `@solana/addresses`.
- **Node ≥ 20.** If the deploy image is older, fix that in this task
  (deploy runtime update) before merging, not as a follow-up.
- No code imports in this task — just the package manifest change.

## Acceptance

- [ ] `@solana/keys` and `@solana/addresses` appear in
      `takumipay-api/package.json` dependencies.
- [ ] `pnpm install` reproduces a clean lockfile.
- [ ] `node --version` in the deploy image reports ≥ 20.
- [ ] `pnpm build` still passes (no accidental import breaks).

## Out of scope

- Consuming the libraries (task 06).
- Polyfill install or fallback ed25519 library.
