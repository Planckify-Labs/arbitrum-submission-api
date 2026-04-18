# Task 09 — `GET /auth/nonce/:walletAddress` — namespace inference

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §3.3 (nonce endpoint), §3.4 (message format)

## Why this matters

The nonce endpoint decides **which protocol message to build** for a
given wallet. Today it's EVM-only. We need it to produce SIWS messages
when the client passes `chainSlug=solana-*` — without adding a new
endpoint (spec §1: "we do not add `/auth/nonce-solana`"). This is the
routing seam between DTO shape (task 03) and the canonical SIWS
builder (task 05).

**Depends on:** task 02 (namespace nonce key), task 03 (DTO), task 05
(SIWS builder).

## Scope

Edit `src/auth/auth.controller.ts` and the corresponding service
method used to create the nonce message:

- Namespace inference:
  - `chainId` set → `namespace = "eip155"` → SIWE builder (existing path).
  - `chainSlug` set:
    - Starts with `solana-` → `namespace = "solana"` → build via
      `SiwsService.buildMessage` with `chainId` cluster mapped from the
      slug (`solana-mainnet` → `"mainnet"`, `solana-devnet` →
      `"devnet"`, `solana-testnet` → `"testnet"`).
    - Otherwise → `400` (unsupported slug for MVP).
  - Neither set → `namespace = "eip155"`, `chainId = CHAIN_ID` env
    (unchanged fallback).
  - Both set → rejected at DTO layer (task 03).
- Store nonce via `NonceCacheService.setNonce(namespace, walletAddress, nonce)`.
  For `eip155` the service lowercases internally; for `solana` it stores
  verbatim.
- Response shape unchanged: `{ nonce, message }`.

SIWS payload fields populated per spec §3.4:
- `domain` ← `SIWE_DOMAIN` env
- `address` ← URL param, base58 verbatim
- `statement` ← `SIWE_STATEMENT` env
- `uri` ← `SIWE_URI` env
- `version` ← `"1"`
- `chainId` ← cluster string from slug
- `nonce` ← 32-byte hex (same generator as SIWE)
- `issuedAt` ← `new Date().toISOString()`
- `expirationTime` ← `issuedAt + NONCE_EXPIRE_TIME_MINUTES`

## Rules (non-negotiable)

- **`expirationTime` MUST equal the Valkey nonce TTL**, derived from
  the same `NONCE_EXPIRE_TIME_MINUTES` env. The signed expiry must not
  outlive the server-side replay window (spec §4).
- **No new endpoint.** `/auth/nonce/:walletAddress` serves both
  protocols.
- **Slug → cluster mapping lives in one helper** next to `SiwsService`,
  not inlined in the controller. Additions (`solana-testnet`) land in
  that helper only.
- **Default fallback path is unchanged.** A request with no query
  params still returns a SIWE message with `CHAIN_ID` env — deployed
  clients must not break.

## Acceptance

- [ ] Controller calls `SiwsService.buildMessage` when
      `chainSlug.startsWith("solana-")`.
- [ ] Nonce is stored via the namespace-aware API from task 02.
- [ ] `expirationTime` in the built SIWS message == now + TTL; unit
      test asserts the two are equal within 1 second.
- [ ] Integration test: `GET /auth/nonce/<base58>?chainSlug=solana-mainnet`
      returns a message beginning with the SIWS header.
- [ ] Integration test: `GET /auth/nonce/0xabc...?chainId=1` returns a
      SIWE message (unchanged behavior).
- [ ] Integration test: unsupported slug → 400.

## Out of scope

- Verify-side dispatch (task 07).
- Verify-side signature decode (task 10).
