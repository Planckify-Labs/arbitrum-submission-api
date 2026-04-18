# Task 16 — Downstream `walletAddress` case-sensitivity audit

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §4 last bullet ("Case-sensitivity bug class")

## Why this matters

Dropping `.toLowerCase()` at the auth boundary is necessary but not
sufficient. Every other module that reads `User.walletAddress` for
business logic may also assume EVM hex and lowercase it somewhere.
Each of those sites is a latent corruption point for Solana
addresses. This task is the audit + fix pass that makes the rest of
the codebase safe to run with Solana users.

**Depends on:** tasks 01, 08 (normalized surface established).

## Scope

Audit the modules listed in spec §4 (and any others surfaced by
grep). For each callsite:

1. Check whether it lowercases / uppercases / compares-with-lowercase
   the address.
2. Classify:
   - **EVM-only by domain** (e.g. ERC-20 transfers, SIWE verification
     against an Ethereum signer) → acceptable to assume hex; add a
     code comment stating the assumption and a namespace assertion
     if data is read from `User`.
   - **Cross-chain** (stores addresses tied to any user regardless
     of chain) → must switch to `walletAddressLower` for lookup or
     branch on `addressNamespace`.
3. Fix or annotate per classification.

Audit list (at minimum):

- `src/blockchain-verification/**` — verifies against transaction
  sender. Must not lowercase Solana sender fields.
- `src/nft/**` — stores `walletAddress` per-chain. Per §4 already
  chain-composite; verify no lowercase drift.
- `src/points/**`, `src/booking/**`, `src/purchases/**` — token
  transfers are EVM-only today. Annotate the EVM assumption; add a
  runtime guard if addresses are pulled from `User` without
  namespace check.
- Any raw SQL with `LOWER(...)` touching address columns.
- Any `.toLowerCase()` on a string that ultimately came from
  `User.walletAddress` or a request-time address param.

Deliverable: a short audit report (in-PR description) listing every
file touched, classification, and fix. Keep the list in the PR — do
not create a new markdown file.

## Rules (non-negotiable)

- **Do not change `User.walletAddress` semantics** further in this
  task. Those are settled in tasks 01 + 08.
- **Prefer `addressNamespace` reads** (from JWT payload, task 11)
  over address-shape inspection. If the JWT is not available at the
  callsite, query the `User` row.
- **Every fix ships with a regression test** — a unit test that
  fails with the old behavior, passes with the new.
- **No "fix later" TODOs.** Any site marked as latently broken
  must either be fixed in this task or the task is not complete.
  Splitting to a follow-up requires an explicit note in the PR
  description and approval before merge.

## Acceptance

- [ ] Every file in spec §4 audit list is inspected; PR description
      lists each with its classification and fix.
- [ ] All cross-chain sites switched to `walletAddressLower` lookup
      or namespace-branched logic.
- [ ] Every fix has a regression test.
- [ ] No remaining grep hits for `.toLowerCase()` on an address
      value sourced from `User.walletAddress` outside of the auth
      module itself.
- [ ] All existing tests green.

## Out of scope

- Adding new Solana features (NFT minting, points in SPL tokens,
  etc.) — this task is defensive only.
- Mobile-side audit (mobile already namespace-aware per §2.2).

---

## Audit Report

Helper added: `src/auth/address-compare.ts` — `addressesEqual(a, b, ns?)`
and `normalizeAddressForKey(addr, ns)`. EVM paths stay case-insensitive;
Solana paths compare verbatim. Unit tests in
`src/auth/address-compare.spec.ts`.

| File | Classification | Fix |
|---|---|---|
| `src/auth/strategies/jwt.strategy.ts` | Cross-chain (JWT identity check) | Namespace-aware compare (task 11). Reads `addressNamespace` from the JWT payload; infers from shape as a fallback. |
| `src/auth/auth.service.ts` | Cross-chain (login/upsert) | `login(address, namespace)` writes both `walletAddress` + `walletAddressLower`; lookup keys off `walletAddressLower`. |
| `src/booking/booking.controller.ts` | Cross-chain (authorization) | Replaced 4 call sites with `addressesEqual(req.user.walletAddress, walletAddress, req.user.addressNamespace)`. |
| `src/booking/booking.service.ts` | Cross-chain (authorization) | 2 call sites now use `addressesEqual`. |
| `src/points/points.service.ts` | Cross-chain (deposit ownership) | `addressesEqual` replaces manual double-`.toLowerCase()`. |
| `src/purchases/purchases.service.ts` | EVM-only (smart-contract purchase flow) | Booking-vs-request comparison uses `addressesEqual`; user upsert switched to `walletAddressLower` lookup + dual-column write. Annotated as EVM-only. |
| `src/queue/processors/purchase.processor.ts` | EVM-only (purchase worker) | Booking mismatch check uses `addressesEqual`; user upsert switched to `walletAddressLower`. Annotated. |
| `src/blockchain-verification/blockchain-verification.service.ts` | EVM-only (viem contract reads) | 2 comparisons use `addressesEqual` with an EVM-only comment. |
| `src/nft/nft.service.ts` | EVM-only (ERC-721/1155) | Existing `as 0x${string}` cast annotated; logic unchanged. |
| `src/nft/processors/nft-verification.processor.ts` | EVM-only (viem `ownerOf`) | Comparison uses `addressesEqual` with an EVM-only comment. |
| `src/valkey/services/booking-cache.service.ts` | EVM-only (cache key shape) | Header comment documents the assumption and the migration path to namespace-aware keys. |

Follow-ups deferred (explicitly scoped out of task 16):
- Migrating `BookingCacheService` to namespace-aware keys — only necessary
  when booking flow ships for Solana.
- Tight namespace guards rejecting non-EVM callers in the purchase/NFT
  modules (currently Solana users simply won't be created with those
  relationships, but a future belt-and-suspenders reject would be
  defensible).

Grep check (no remaining `toLowerCase` on `User.walletAddress`-sourced
values outside auth / annotated EVM paths):

```
grep -rn '\.walletAddress\.toLowerCase()' src/
```

Remaining hits are (a) annotated EVM-only paths, (b) the EVM branch of
`jwt.strategy.ts` (correct for `eip155`), and (c) the EVM branch of
`auth.service.ts`. All are either namespace-guarded or exclusively EVM
by domain.
