# Task 14 — Assert `derived(QUOTE_SIGNER_PRIVATE_KEY) === Blockchain.quoteSignerAddress` at boot

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §6 (last paragraph)

## Why this matters

If the env private key and the on-chain `backendSigner` (persisted in
`Blockchain.quoteSignerAddress`) diverge — e.g., after a key rotation
where only one side was updated — every customer payment silently
reverts with `BAD_QUOTE`. This assertion catches the mismatch at
service boot, preventing a P0 incident from reaching production.

## Scope

- At `OnchainSettlementProvider` (or `QuoteSignerService`) module
  initialization (`onModuleInit`), for every active EVM chain
  (`Blockchain.isActive = true, isEVM = true`):
  1. Derive the public address from `QUOTE_SIGNER_PRIVATE_KEY` using
     viem's `privateKeyToAddress`.
  2. Read `Blockchain.quoteSignerAddress` from DB.
  3. If `quoteSignerAddress` is set and doesn't match the derived
     address → throw a fatal error that prevents app boot.
  4. If `quoteSignerAddress` is null (not yet deployed) → log a warning
     but don't fail (allows development against chains without a
     deployed contract).

- In production (`NODE_ENV === "production"`), also assert that
  `QUOTE_SIGNER_PRIVATE_KEY !== ADMIN_WALLET_PRIVATE_KEY` (key
  separation rule from §12.5).

## Rules (non-negotiable)

- **Fail loud.** Mismatch = app does not start. Not a warning, not a
  log line — a thrown error.
- **Only for active EVM chains.** Don't fail on inactive chains or
  Solana rows.
- **Key separation in prod only.** Dev/staging can share keys for
  convenience.

## Acceptance

- [ ] App fails to boot if derived address !== `quoteSignerAddress` for
      any active EVM chain with a non-null `quoteSignerAddress`.
- [ ] App boots with a warning if `quoteSignerAddress` is null.
- [ ] In production, app fails to boot if quote signer key === admin key.
- [ ] Unit test with mocked Prisma: matching addresses → OK; mismatched
      → throws.
- [ ] `pnpm run build` passes.

## Out of scope

- Signer rotation runbook (§11 open question).
- Multi-sig migration (§12.7 item 4).
