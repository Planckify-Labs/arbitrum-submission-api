# Task 13 — Mobile `app/auth.tsx` — namespace branch + Solana signer

**Status:** Not taken
**Owner:** Mobile (mobile-app)
**Spec reference:** `SIWS_SPEC.md` §3.7 item 2, §2.2

## Why this matters

`app/auth.tsx:124-128` hardcodes
`walletClient.signMessage({ account, message })` — an EVM-only path
via viem. A Solana active wallet today would hit this and fail with a
type or ABI error. Branching by `activeWallet.namespace` is the final
end-user-visible step that lights up SIWS.

**Depends on:** task 12 (namespace-aware `useNonce`), task 10 (server
accepts SIWS verify).

## Scope

Edit `mobile-app/app/auth.tsx`:

- Replace `getEvmChainId(activeChain)` with a branch on
  `activeWallet.namespace` (already available per §2.2 /
  `TWallet.namespace`).
- For `activeWallet.namespace === "eip155"`:
  - Pass `{ chainId: <existing evm chain id> }` to `useNonce`.
  - Keep the existing `walletClient.signMessage` path.
- For `activeWallet.namespace === "solana"`:
  - Determine cluster via existing chain state; map to
    `chainSlug: "solana-mainnet"` or `"solana-devnet"`.
  - Pass `{ chainSlug }` to `useNonce`.
  - Sign via `services/chains/solana/signer.ts`'s `signMessage` path
    (already wraps `KeyPairSigner.signMessages`).
  - Base58-encode the signature bytes before POST (spec §3.3:
    base58 primary on the wire).
- `useVerifySignature` body stays unchanged — still
  `{ message, signature }`.

## Rules (non-negotiable)

- **No new namespace detection logic.** Read
  `activeWallet.namespace` — it exists. Do not re-derive from address
  shape, prefix, or length.
- **Do not lowercase the base58 address** when sending to the server
  or when comparing against the JWT response. Solana addresses flow
  through verbatim everywhere.
- **Signature encoding is base58 for Solana.** No base64 from the
  client; the server accepts base64 only as a compatibility fallback
  for third-party adapters (§3.3), not as a preferred format.
- **Sui / Bitcoin are out of scope.** A `default` branch on the
  namespace switch should throw a developer-visible error, not
  silently fall back to EVM.

## Acceptance

- [ ] `app/auth.tsx` branches on `activeWallet.namespace`; there is
      no remaining hard-coded EVM assumption in the sign flow.
- [ ] EVM path is behavior-identical to today (integration smoke
      test: existing user signs in successfully).
- [ ] Solana path: signing with a `mainnet` wallet produces a JWT
      on the server; `jwtPayload.addressNamespace === "solana"`.
- [ ] Solana path: signing with `devnet` wallet hits
      `chainSlug=solana-devnet`.
- [ ] `default` branch in the namespace switch throws a descriptive
      error referencing the missing adapter.

## Out of scope

- Extending `services/chains/solana/signer.ts` (already exists per
  spec §2.2).
- SIWS canonical builder on mobile (already exists per
  `services/chains/solana/siws.ts`).
- Non-Solana namespaces (Sui tracked in the Wallet-Standard task
  backlog).
