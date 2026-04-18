# Task 12 — Mobile `useNonce(address, { chainId?, chainSlug? })`

**Status:** Not taken
**Owner:** Mobile (mobile-app)
**Spec reference:** `SIWS_SPEC.md` §3.7 item 1

## Why this matters

`hooks/queries/useAuth.ts:135-155` hardcodes `?chainId=${chainId}`,
with `chainId` typed as number. Solana needs `chainSlug` instead. The
hook is the single client-side seam between the app's wallet state
and the auth endpoint — making it namespace-aware is prerequisite to
everything in `auth.tsx` (task 13).

**Depends on:** task 03 (server DTO accepts `chainSlug`), task 09
(server builds SIWS when `chainSlug` is solana-*).

## Scope

Edit `mobile-app/hooks/queries/useAuth.ts`:

- New signature:
  ```ts
  useNonce(
    address: string,
    opts: { chainId?: number; chainSlug?: string },
  ): UseQueryResult<{ nonce: string; message: string }>;
  ```
- Build the query string from whichever of `chainId` / `chainSlug` is
  set. Both unset → no query param (server falls back to
  `CHAIN_ID` env).
- Both set → refuse at the type level if feasible (overload /
  discriminated union), or throw in dev. The server will also 400,
  but catching it client-side is cheaper.
- Query key includes the chosen param so switching wallets
  invalidates correctly. E.g.
  `["auth", "nonce", address, chainId ?? chainSlug]`.
- Existing `useVerifySignature` is **unchanged** — it already POSTs
  `{ message, signature }` and the server's verify dispatcher handles
  protocol detection.

## Rules (non-negotiable)

- **Do not lowercase the address in the fetch URL for Solana.** Base58
  is case-sensitive; the server nonce key depends on the exact
  address the client sent at nonce time (spec §3.2).
- **Keep the return shape `{ nonce, message }`.** The signing flow in
  `auth.tsx` reads both fields — do not expand or rename.
- **Query key change is a cache break.** Acceptable — nonces expire
  in ~5 min and are single-use; no persistence concern.
- **No `namespace` param in this hook.** Namespace is implied by
  which of `chainId` / `chainSlug` is set. Passing both would be
  redundant.

## Acceptance

- [ ] `useNonce(address, opts)` accepts `chainId` | `chainSlug`
      optional opts.
- [ ] Fetch URL includes only the set param; empty opts → no query
      string.
- [ ] Query key distinguishes EVM-id-1 from `solana-mainnet` from
      `solana-devnet`.
- [ ] Unit / hook test: mounting with `{ chainSlug: "solana-mainnet" }`
      hits `/auth/nonce/<addr>?chainSlug=solana-mainnet`.
- [ ] Unit / hook test: existing EVM call with `{ chainId: 1 }` is
      byte-identical to pre-task behavior.
- [ ] `pnpm check:syntax` passes in `mobile-app`.

## Out of scope

- Calling this hook from `auth.tsx` (task 13).
- Verify endpoint call changes (none required).
