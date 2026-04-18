# Task 11 — JWT payload `addressNamespace`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §3.6

## Why this matters

`payload.walletAddress` today implicitly means "EVM hex". Adding
Solana breaks that implicit contract — a downstream service that
`.toLowerCase()`s the address will corrupt Solana base58. Adding an
explicit `addressNamespace` field makes the discriminator first-class,
so no consumer has to string-inspect the address to know which family
it belongs to. The spec marks this **recommended** for exactly this
reason.

**Depends on:** task 08 (login receives namespace).

## Scope

- Extend the JWT payload type (wherever it's declared — likely
  `src/auth/jwt-payload.interface.ts` or similar) with:
  ```ts
  addressNamespace: "eip155" | "solana";
  ```
- Update the token-signing call site (inside `AuthService.login` or
  its helper) to include `addressNamespace` from the namespace already
  threaded through in task 08.
- Update the JWT strategy (`src/auth/jwt.strategy.ts` or equivalent)
  to surface `addressNamespace` on the authenticated request user
  object so controllers and guards can read it without parsing the
  address.
- Document the new field in `AuthResponseDto` / Swagger schema if
  the payload is exposed there.

## Rules (non-negotiable)

- **Required field, not optional.** TypeScript must refuse any sign
  call that forgets it. Any issued token missing the field is an
  unambiguous bug.
- **Values are exactly `"eip155"` or `"solana"`.** Match the string
  union used everywhere else in the codebase.
- **Do not store cluster** (`"mainnet"` / `"devnet"`) in the JWT —
  spec §3.6 and §7 Q2 note that most flows bind cluster via
  transaction `recentBlockhash`, not the auth token. Keep the payload
  minimal.
- **No compatibility shim.** Existing EVM tokens before this deploy
  expire naturally (short JWT lifetime); new tokens always include
  the field. Do not special-case "missing namespace = EVM" in readers
  — that re-introduces the implicit contract this task removes.

## Acceptance

- [ ] JWT payload type has `addressNamespace: "eip155" | "solana"`.
- [ ] `jwt.strategy.ts` (or equivalent) passes the field through to
      `req.user`.
- [ ] Unit test: signing with `"eip155"` produces a decodable token
      with `addressNamespace === "eip155"`.
- [ ] Unit test: signing with `"solana"` produces a decodable token
      with `addressNamespace === "solana"`.
- [ ] Existing SIWE integration test still green (token issued,
      validated, decoded).

## Out of scope

- Refactoring downstream consumers to use `addressNamespace` instead
  of address-inspection (follow-up; spec §4 audit is task 16).
- Adding `cluster` to the payload (explicitly rejected by spec §3.6).
