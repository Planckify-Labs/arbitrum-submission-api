# Task 05 — Rename `usdcAmountMicros` → `tokenAmountMinor`, `usdcSourceChainId` → `sourceChainId`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §5.3

## Why this matters

The existing columns are USDC-specific names. Multi-token support (§4.8)
requires token-agnostic naming. Renaming now (before new code references
them) keeps the schema clean and avoids a painful rename later when more
code depends on the old names.

## Scope

- Rename `PaymentIntent.usdcAmountMicros` → `tokenAmountMinor` (`BigInt`).
- Rename `PaymentIntent.usdcSourceChainId` → `sourceChainId` (`Int`).
- Use Prisma's `@map` to keep the underlying DB column name for one
  release if needed for backward compatibility with any external
  consumer. Otherwise, a straight rename migration is preferred.
- Update all application code references to use the new field names.
  Search the codebase for `usdcAmountMicros` and `usdcSourceChainId`.
- Generate and apply the Prisma migration.
- Run `bash scripts/lint-migrations.sh`.
- Regenerate Prisma client.

## Rules (non-negotiable)

- **Every code reference must be updated.** `grep -r` for the old names
  after the rename — zero hits required (except migration SQL and
  changelog).
- **Migration must handle existing data.** These are `ALTER TABLE RENAME
  COLUMN` — no data loss.
- **Tests must pass.** Any test referencing the old column names must be
  updated.

## Acceptance

- [ ] `prisma/schema.prisma` uses `tokenAmountMinor` and `sourceChainId`.
- [ ] Migration SQL is a column rename (not drop + add).
- [ ] `grep -rn 'usdcAmountMicros\|usdcSourceChainId' src/ test/` returns
      zero results.
- [ ] `pnpm prisma migrate dev` applies cleanly.
- [ ] `pnpm run build` and `pnpm run test` pass.
- [ ] `bash scripts/lint-migrations.sh` passes.

## Out of scope

- New columns on `PaymentIntent` (task 06).
- Multi-token DTO changes (task 20).
