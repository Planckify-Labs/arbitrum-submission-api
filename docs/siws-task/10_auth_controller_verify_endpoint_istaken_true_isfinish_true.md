# Task 10 — `POST /auth/verify` — drop EVM-only regex, accept base58/base64

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §2.3 gaps 3–4, §3.3 (verify endpoint)

## Why this matters

`auth.controller.ts:68` extracts the signer address from the message
via `/0x[a-fA-F0-9]{40}/i` — a hard block on non-EVM flows. Likewise
`createSiweMessage` rejects non-`0x` inputs. With the dispatcher
(task 07) doing protocol routing internally, the controller's job is
purely to pass `{ message, signature }` through and return the result.

**Depends on:** task 07 (dispatcher), task 08 (namespace-aware login),
task 09 (nonce endpoint).

## Scope

Edit `src/auth/auth.controller.ts`:

- Remove the EVM hex regex in the verify handler.
- Pass `{ message, signature }` straight to
  `authService.verifySignature(message, signature)`.
- Use the `address` and `namespace` **returned by the dispatcher** to
  call `authService.login(address, namespace)`.
- Existing HTTP status contract preserved:
  - Verify failure → `401`
  - Login failure → `500`
  - Success → 200 with `AuthResponseDto`.

Edit `src/auth/auth.service.ts` (if not already in task 07):

- Remove the `createSiweMessage` hard rejection of non-`0x` input.
  That function is EVM-specific now; it must only be called with EVM
  namespace. Gate the call on namespace in the nonce flow (task 09).

No DTO change for `POST /auth/verify` — body stays
`{ message, signature }`.

## Rules (non-negotiable)

- **No address extraction in the controller.** The verifier is the
  source of truth for signer identity — the controller trusts what the
  dispatcher returns. Parsing the address from the message at the
  controller is what broke Solana in the first place.
- **Signature is a string, no parsing in the controller.** SIWE is
  hex-0x, SIWS is base58-or-base64; each verifier owns its decode
  (SIWS decode lives in task 06).
- **Error messages stay generic.** `401 Unauthorized` with a static
  body; never leak whether the failure was nonce, signature, or
  expiry — matches existing SIWE behavior.

## Acceptance

- [ ] `auth.controller.ts` contains no hex/base58 regex for address
      extraction in the verify handler.
- [ ] Controller calls `login(address, namespace)` using dispatcher
      output (task 07).
- [ ] SIWE round-trip integration test still green.
- [ ] SIWS round-trip integration test (task 15) is green when run
      against this endpoint.
- [ ] Malformed base58 SIWS signature → `401`, never `500`.

## Out of scope

- Full round-trip test infrastructure (task 15).
- Case-sensitivity audit of downstream consumers (task 16).
