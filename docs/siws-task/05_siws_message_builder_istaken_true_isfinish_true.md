# Task 05 — Canonical `buildSiwsMessage` (server-side)

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §3.4, §3.5 (`SiwsService.buildMessage`)

## Why this matters

The server must produce **byte-for-byte identical** SIWS message
strings to what the mobile app signs. Any whitespace, line-ending, or
field-ordering drift causes ed25519 verification to fail in a way that
looks like "user rejected" from the outside. Single canonical builder
on both sides avoids this entire failure class.

## Scope

Create `src/auth/siws/siws-message.ts`:

- Export `buildSiwsMessage(input: SiwsPayload): string` that mirrors
  `mobile-app/services/chains/solana/siws.ts` — same field order, same
  header, same `\n` separators, same `Expiration Time:` / `Issued At:`
  labels.
- Export `SiwsPayload` type matching the mobile version (`domain`,
  `address`, `statement`, `uri`, `version`, `chainId`, `nonce`,
  `issuedAt`, `expirationTime`, optional `notBefore`, `requestId`,
  `resources`).
- Export `parseSiwsMessage(message: string): SiwsPayload` — tolerant
  parser for the verify path. Reject CRLF (mobile rejects it too; code
  `-32602` for consistency) and reject `expirationTime <= issuedAt`.
- Header MUST be exactly:
  `"<domain> wants you to sign in with your Solana account:"`.
  A deviation here is a silent auth break.

## Rules (non-negotiable)

- **Byte-identical output.** A unit test (task 14) will import the
  mobile builder's expected fixtures and diff against this one. If it
  diverges, this task is not done.
- **Line endings are `\n`.** Never `\r\n`. Builder emits `\n`; parser
  rejects any message containing `\r`.
- **No Nest DI here.** This is a pure function module — no
  `@Injectable`, no service class. `SiwsService` (task 06) wraps it.
  Keeps the builder unit-testable without a Nest test module.
- **`chainId` value is the cluster string** (`"mainnet"` |
  `"devnet"` | `"testnet"`), not a slug and not a number. Mapping from
  `Blockchain.chainSlug` (`"solana-mainnet"` → `"mainnet"`) happens at
  the controller seam (task 09), not here.

## Acceptance

- [ ] `src/auth/siws/siws-message.ts` exports `buildSiwsMessage`,
      `parseSiwsMessage`, `SiwsPayload`.
- [ ] Round-trip test: for a fixed payload,
      `parseSiwsMessage(buildSiwsMessage(p))` deep-equals `p`.
- [ ] Parser rejects CRLF input with a structured error usable by the
      caller.
- [ ] Parser rejects `expirationTime <= issuedAt`.
- [ ] No imports from `@nestjs/*`; file compiles in a node-only
      context.

## Out of scope

- Signature verification (task 06).
- Wiring into the controller (task 09).
- Actually diffing against mobile fixtures — that lives in task 14's
  test file.
