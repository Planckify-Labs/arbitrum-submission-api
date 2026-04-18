# Task 02 — `NonceCacheService.buildKey(namespace, address)`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §2.3 gap 2, §3.2

## Why this matters

The current nonce cache key is `nonce:${walletAddress.toLowerCase()}`.
Lowercasing a Solana base58 pubkey produces a wrong key, so the nonce
set by `GET /auth/nonce` would never be found by `POST /auth/verify`.
We need a namespace-prefixed key where EVM keeps lowercasing (no
behavior change) and Solana preserves case.

## Scope

Edit `valkey/services/nonce-cache.service.ts`:

- Add a private method `buildKey(namespace: "eip155" | "solana", address: string): string`:
  - `eip155` → `nonce:eip155:${address.toLowerCase()}`
  - `solana` → `nonce:solana:${address}` (verbatim; no case change)
- Route every read/write/delete inside the service through `buildKey`.
  No call site in this file should interpolate the key string directly.
- Extend the public API:
  - `setNonce(namespace, address, nonce, ttl?)`
  - `getNonce(namespace, address)`
  - `deleteNonce(namespace, address)`
  Keep the old `(address)`-only signatures temporarily as thin wrappers
  that default `namespace: "eip155"` — the controller/service migration
  happens in tasks 08–10.

## Rules (non-negotiable)

- **Namespace is a string-literal union** matching the rest of the
  codebase (`"eip155" | "solana"`). No enum.
- **EVM lowercases the address segment** — preserve today's semantics
  for in-flight EVM nonces during rollout.
- **Solana does not lowercase.** Ever. Not in this service, not in
  callers. The test must explicitly assert mixed-case base58 survives
  round-trip.
- **Single source of truth for key format.** If the key format needs to
  change later, `buildKey` is the only edit site.

## Acceptance

- [ ] `buildKey` added; every `set`/`get`/`delete` goes through it.
- [ ] New overloads accept `(namespace, address, ...)`; legacy
      `(address, ...)` overloads default to `"eip155"` and are marked
      `@deprecated` with a TODO referencing task 08.
- [ ] Unit test: `setNonce("solana", "ABcd...", "x")` then
      `getNonce("solana", "ABcd...")` returns `"x"`; lowering the
      address returns `null`.
- [ ] Unit test: `setNonce("eip155", "0xABCD...", "y")` then
      `getNonce("eip155", "0xabcd...")` returns `"y"` (case-insensitive
      EVM match preserved).
- [ ] No call site outside this service constructs `nonce:...` strings
      directly (grep check).

## Out of scope

- Calling the new overloads from controllers/services (tasks 06, 09, 10).
- Removing the legacy `(address)`-only wrappers (follow-up after task 10).
