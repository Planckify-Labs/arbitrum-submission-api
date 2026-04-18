# Task 07 — `AuthService.verifySignature` dispatcher (SIWE vs SIWS)

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §3.3 (verify endpoint), §3.5

## Why this matters

`POST /auth/verify` is the single entry point for both wallet families.
The dispatcher decides which protocol a message belongs to from the
message bytes alone — no new query param, no body flag. Detection by
content keeps the HTTP surface unchanged (spec §3.3: "shape unchanged")
while routing to the right verifier.

## Scope

Edit `src/auth/auth.service.ts`:

- Inject `SiwsService` (task 06) via constructor.
- Refactor `verifySignature(message, signature)` into a dispatcher:
  - If `message` contains
    `"wants you to sign in with your Solana account:"` → delegate to
    `this.siwsService.verify(message, signature)`. Map result to the
    existing shape (`{ success, address, ... }`). `namespace` is
    `"solana"`.
  - If `message` contains
    `"wants you to sign in with your Ethereum account:"` → existing
    SIWE path. `namespace` is `"eip155"`.
  - Else → return `{ success: false }` (controller → 401).
- The dispatcher's return type gains `namespace: "eip155" | "solana"`
  so `login` (task 08) can route the upsert correctly.

## Rules (non-negotiable)

- **Detection is string-contains, case-sensitive** on the header
  substring. Both SIWE and SIWS headers are verbatim in the spec; a
  looser match (e.g. lowercasing the message) risks accepting
  crafted messages.
- **Never run both verifiers on one input.** First match wins; no
  fallback between protocols.
- **SIWE path is unchanged.** This task must not alter SIWE signature
  decoding, nonce handling, or error messages — integration test for
  SIWE stays green.
- **Return shape preserves `AuthResponseDto` compatibility.** Callers
  downstream (controller) should not change for this task.

## Acceptance

- [ ] `SiwsService` injected into `AuthService`.
- [ ] Dispatcher branches on the SIWS/SIWE header substring with no
      other heuristics.
- [ ] Unit test: SIWE message + hex signature → SIWE path called.
- [ ] Unit test: SIWS message + base58 signature → SIWS path called.
- [ ] Unit test: garbage message → `{ success: false }`, no verifier
      invoked.
- [ ] Existing SIWE integration tests still pass.

## Out of scope

- Namespace-aware upsert (task 08).
- Controller-level regex changes (task 10).
- Adding `addressNamespace` to the JWT payload (task 11).
