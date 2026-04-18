# Task 08 — `AuthService.login(address, namespace)` — namespace-aware upsert

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §3.1, §3.5 (login), §2.3 gap 1

## Why this matters

`login` is the single place `User` rows are upserted from auth. The
current implementation `.toLowerCase()`s the address, which corrupts
Solana base58. This task makes the write/read paths namespace-aware:
EVM keeps lowercase semantics via `walletAddressLower`; Solana stores
the verbatim base58 and looks up exactly. Together with task 01 this
closes gaps §2.3 1–2.

**Depends on:** task 01 (column + unique index), task 07 (dispatcher
passes `namespace`).

## Scope

Edit `src/auth/auth.service.ts`:

- Change `login(address)` → `login(address: string, namespace: "eip155" | "solana")`.
- Compute `inputLower = namespace === "eip155" ? address.toLowerCase() : address`.
- **Lookup**: `prisma.user.findUnique({ where: { walletAddressLower: inputLower } })`.
- **Upsert on miss**:
  - `walletAddress: address` (verbatim — no casing)
  - `walletAddressLower: inputLower`
- Update every caller of `login` to pass `namespace`. There is one
  caller today inside `AuthService` itself; task 07 added `namespace`
  to the dispatcher return so it threads through cleanly.
- Remove the `.toLowerCase()` at every boundary inside this service
  that touches the address for identity lookup — `walletAddressLower`
  is the only normalized surface.

## Rules (non-negotiable)

- **Never lowercase a Solana address.** Not in lookup, not in storage,
  not in logs. `inputLower === address` verbatim when namespace is
  `"solana"`.
- **`walletAddress` stores the emitted-by-wallet form.** For EVM that
  means EIP-55 mixed case or lowercase, depending on what the client
  sent; we do not normalize it — only `walletAddressLower` is
  normalized.
- **Atomic write.** Both columns are set in the same `create`/`update`
  call. Never a two-step upsert that could leave `walletAddressLower`
  NULL.
- **Backwards compatibility**: EVM clients that sent mixed-case
  addresses before still log in. Unit test must cover `"0xABCD..."`
  stored, then lookup via `"0xabcd..."`.

## Acceptance

- [ ] `login(address, namespace)` signature in `auth.service.ts`.
- [ ] All writes set both `walletAddress` and `walletAddressLower`.
- [ ] All reads use `walletAddressLower`.
- [ ] Unit test: EVM login writes lower into `walletAddressLower`,
      verbatim into `walletAddress`.
- [ ] Unit test: Solana login writes mixed-case base58 verbatim into
      BOTH columns (since `inputLower = address` in that branch).
- [ ] Unit test: re-login with the same address idempotently returns
      the same user row.
- [ ] Existing SIWE integration test green.

## Out of scope

- JWT payload changes (task 11).
- Downstream modules that read `walletAddress` for business logic
  (task 16 audit).
